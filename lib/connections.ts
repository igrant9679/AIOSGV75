import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { vaultAvailable, vaultInfo } from "./vault";

/**
 * Connections (/connections, rule 51): every sign-in, key and service the fleet uses, in one list, with
 * where to manage each. It gathers what other pages already know (it stores nothing new and never returns a
 * key's value): AI sign-ins per machine and their plan limits (the fleet snapshot), models added by key
 * (names only), and the services (vault, GitHub, Telegram, LevelUp, the Work home).
 *
 * Subscriptions: what each plan costs and when it renews, kept in the vault
 * (Agentic OS/Cluster/subscriptions.json) so every machine shows the same list, next to its live usage.
 */

type Any = any;
export interface Subscription { id: string; name: string; plan?: string; tool?: string; monthly: number; renewDay?: number; note?: string }
const subFile = () => path.join(vaultInfo().base, "Cluster", "subscriptions.json");

export function readSubscriptions(): Subscription[] {
  try {
    const j = JSON.parse(fs.readFileSync(subFile(), "utf8"));
    return Array.isArray(j?.subscriptions) ? j.subscriptions : [];
  } catch {
    return [];
  }
}
async function writeSubscriptions(list: Subscription[]) {
  if (!(await vaultAvailable())) throw new Error("The vault isn't available on this machine.");
  const f = subFile();
  await fsp.mkdir(path.dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify({ v: 1, subscriptions: list }, null, 1), "utf8");
  for (let i = 0; ; i++) {
    try {
      await fsp.rename(tmp, f);
      return;
    } catch (e) {
      if (i >= 8) throw e;
      await new Promise((r) => setTimeout(r, 250 * (i + 1)));
    }
  }
}
export async function saveSubscription(raw: Any): Promise<Subscription[]> {
  const name = String(raw?.name ?? "").trim().slice(0, 60);
  if (!name) throw new Error("Name the subscription.");
  const monthly = Math.round(Math.max(0, Math.min(100000, Number(raw?.monthly) || 0)) * 100) / 100;
  const day = Number(raw?.renewDay);
  const sub: Subscription = {
    id: typeof raw?.id === "string" && raw.id ? raw.id : `sub-${Date.now().toString(36)}`,
    name,
    plan: String(raw?.plan ?? "").trim().slice(0, 40) || undefined,
    tool: ["claude", "codex", "gemini", "hermes", "kimi", "other"].includes(raw?.tool) ? raw.tool : undefined,
    monthly,
    renewDay: Number.isInteger(day) && day >= 1 && day <= 31 ? day : undefined,
    note: String(raw?.note ?? "").trim().slice(0, 200) || undefined,
  };
  const list = readSubscriptions();
  const i = list.findIndex((s) => s.id === sub.id);
  if (i >= 0) list[i] = sub;
  else list.push(sub);
  await writeSubscriptions(list);
  return list;
}
export async function deleteSubscription(id: string): Promise<Subscription[]> {
  const list = readSubscriptions().filter((s) => s.id !== id);
  await writeSubscriptions(list);
  return list;
}

export async function connectionsView(): Promise<Any> {
  const { buildSnapshot } = await import("./fleetSnapshot");
  const snap: Any = await buildSnapshot();
  const { readRegistry, isLocalEndpoint } = await import("./registry");
  const reg: { llms: Any[] } = await readRegistry().catch(() => ({ llms: [] as Any[] }));
  const { ghAccounts } = await import("./github");
  const { telegramTransport } = await import("./telegram");
  let gh: { installed: boolean; accounts: Any[] } = { installed: false, accounts: [] };
  try {
    gh = ghAccounts();
  } catch {
    /* not installed */
  }
  const levelup = (snap.levelup ?? [])[0];
  const home = (await import("./workHome")).readWorkHome();
  const vaultOk = await vaultAvailable();
  const bot = telegramTransport() === "bot";
  const tools = ["claude", "codex", "gemini", "hermes", "kimi"];
  const signins = tools
    .map((tool) => ({
      tool,
      machines: (snap.machines ?? []).map((m: Any) => {
        const s = (m.subscriptions ?? []).find((x: Any) => x.tool === tool);
        return { machine: m.label, online: m.online, status: s?.status ?? "not_set_up", plan: s?.plan, usedPercent: s?.usedPercent, resetsAt: s?.resetsAt, note: s?.note };
      }),
    }))
    .filter((t) => t.machines.some((m: Any) => m.status !== "not_set_up") || ["claude", "codex"].includes(t.tool));
  return {
    at: Date.now(),
    signins,
    models: reg.llms.map((l: Any) => ({ id: l.id, name: l.name, provider: l.provider, model: l.model, local: isLocalEndpoint(l.baseUrl), ready: isLocalEndpoint(l.baseUrl) || Boolean(l.apiKey), autoRoute: Boolean(l.autoRoute) })),
    services: [
      { id: "vault", name: "Obsidian vault (the shared brain)", ok: vaultOk, detail: vaultOk ? "Reachable on this machine; shared through OneDrive." : "Not reachable on this machine.", manage: "/settings" },
      { id: "github", name: "GitHub", ok: gh.accounts.length > 0, detail: gh.accounts.length ? `Signed in here as ${gh.accounts.map((a: Any) => a.login).join(", ")}.` : gh.installed ? "The GitHub CLI isn't signed in on this machine (the Work home borrows reports from one that is)." : "The GitHub CLI isn't installed on this machine.", manage: "/github" },
      { id: "telegram", name: "Telegram (Talos)", ok: bot, detail: bot ? "This machine can send Telegram messages." : "No bot token on this machine (only machines that may become master need one).", manage: "/fleet" },
      { id: "levelup", name: "LevelUp", ok: Boolean(levelup?.connected && levelup.status?.ok !== false), detail: levelup?.connected ? `Connected on ${levelup.heldBy}${levelup.status?.ok === false ? `, but the last check failed: ${levelup.status.error}` : "."}` : `Not connected. Make a key in LevelUp (Fleet), then connect in Work${home ? `: it is kept on ${home.label}` : ""}.`, manage: "/work" },
      { id: "workhome", name: "Work home", ok: Boolean(home), detail: home ? `Work is kept on ${home.label}.` : "No Work home chosen: each machine keeps its own.", manage: "/work" },
    ],
    machines: (snap.machines ?? []).map((m: Any) => ({ label: m.label, online: m.online, localModel: m.localModel, acpAgents: m.acpAgents })),
    subscriptions: readSubscriptions(),
    notReached: snap.notReachedOverLan ?? [],
  };
}
