import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { cliAvailable } from "./cliAvailable";
import { hermesInstalled } from "./hermesSessions";
import { acpInstalled, findAcpAgent, readAcpAgents } from "./acpAgents";
import { servedLocalModel } from "./localModel";
import { readWorkerModelSettings } from "./nousModels";
import { DEFAULT_ORDER, STEP_RE, type FallbackStep } from "./fallbackPlan";
import type { SubscriptionMeter } from "./sessions";

/**
 * This machine's "when a plan hits its limit" setting (data/fallback.json) and what each step needs
 * to be usable here. Each machine decides for itself: the fallback runs where the conversation was
 * running, with that machine's tools and sign-ins.
 *
 *   { "enabled": true, "order": ["claude", "codex", "local"] }
 *
 * Every step is a subscription or free: Claude and Codex on their plans (API keys are stripped,
 * AGENTS.md rule 8), an ACP agent on its own sign-in, the local model on this PC. Hermes is not in
 * the default order because it may run on Nous credit; add it if its sign-in is a plan.
 */

export interface FallbackSettings {
  enabled: boolean;
  order: FallbackStep[];
}

const FILE = path.join(process.cwd(), "data", "fallback.json");

export async function readFallback(): Promise<FallbackSettings> {
  try {
    const raw = JSON.parse(await fsp.readFile(FILE, "utf8")) as Partial<FallbackSettings>;
    const order = Array.isArray(raw.order) ? raw.order.filter((s): s is string => typeof s === "string" && STEP_RE.test(s)) : DEFAULT_ORDER;
    return { enabled: raw.enabled !== false, order: [...new Set(order)] };
  } catch {
    return { enabled: true, order: DEFAULT_ORDER };
  }
}

export async function saveFallback(v: Partial<FallbackSettings>): Promise<FallbackSettings> {
  const cur = await readFallback();
  const next: FallbackSettings = {
    enabled: typeof v.enabled === "boolean" ? v.enabled : cur.enabled,
    order: Array.isArray(v.order) ? [...new Set(v.order.filter((s): s is string => typeof s === "string" && STEP_RE.test(s)))].slice(0, 12) : cur.order,
  };
  await fsp.mkdir(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(next, null, 2), "utf8");
  await fsp.rename(tmp, FILE);
  return next;
}

/**
 * Can this step run here right now? Installed, signed in as far as can be told without opening a
 * credentials file's contents, and not known to be at its limit on this machine.
 */
export async function stepReady(step: FallbackStep, meters: SubscriptionMeter[] = []): Promise<{ ok: boolean; why?: string }> {
  const limited = (tool: string) => meters.some((m) => m.tool === tool && m.status === "limited" && (!m.resetsAt || m.resetsAt > Date.now()));
  if (step === "claude") {
    if (!cliAvailable("claude")) return { ok: false, why: "not installed" };
    if (limited("claude")) return { ok: false, why: "at its limit" };
    return { ok: true };
  }
  if (step === "codex") {
    if (!cliAvailable("codex")) return { ok: false, why: "not installed" };
    // signed in = the file exists; it is never read here
    if (!fs.existsSync(path.join(os.homedir(), ".codex", "auth.json"))) return { ok: false, why: "not signed in" };
    if (limited("codex")) return { ok: false, why: "at its limit" };
    return { ok: true };
  }
  if (step === "hermes") {
    const bin = process.env.HERMES_BIN;
    if (!(bin ? fs.existsSync(bin) : cliAvailable("hermes")) || !hermesInstalled()) return { ok: false, why: "not installed" };
    return { ok: true };
  }
  if (step === "local") {
    const pref = (await readWorkerModelSettings()).local;
    if (pref === false) return { ok: false, why: 'switched off ("local": false)' };
    return (await servedLocalModel(pref || undefined)) ? { ok: true } : { ok: false, why: "no local model running" };
  }
  if (step.startsWith("acp:")) {
    const a = await findAcpAgent(step.slice(4));
    if (!a) return { ok: false, why: "not switched on here" };
    if (!acpInstalled(a.command)) return { ok: false, why: "not installed" };
    return { ok: true };
  }
  return { ok: false, why: "unknown" };
}

/** Labels for the steps, ACP agents by their configured name. */
export async function stepLabels(): Promise<Record<string, string>> {
  const out: Record<string, string> = { claude: "Claude Code", codex: "Codex", hermes: "Hermes", local: "Local model" };
  for (const a of await readAcpAgents()) out[`acp:${a.id}`] = a.label;
  return out;
}
