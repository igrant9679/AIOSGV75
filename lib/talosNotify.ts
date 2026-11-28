import fsp from "fs/promises";
import path from "path";

/**
 * Telegram notifications for the owner (rule 47, step 4): what needs them or finished, as it happens,
 * plus a morning digest; quiet hours hold the alerts for the digest. Sent by the MASTER (the machine
 * that sends Mission Control's Telegram messages), from the fleet snapshot, every two minutes. Each event
 * is sent once (data/talos-notify-state.json); on the first pass everything already there is only
 * remembered, so switching it on doesn't flood the chat. Approvals and health problems are left out
 * because Mission Control already sends those.
 *
 * Settings (data/talos.json, this machine): notifications, quiet hours, digest time, Telegram failover.
 */

type Any = any;
const DATA = path.join(process.cwd(), "data");
const SETTINGS = path.join(DATA, "talos.json");
const STATE = path.join(DATA, "talos-notify-state.json");

export interface TalosSettings {
  notify: boolean;
  quietFrom: string;
  quietTo: string;
  digest: boolean;
  digestAt: string;
  events: { results: boolean; failures: boolean; permissions: boolean; levelup: boolean; offline: boolean; limits: boolean };
  /** step 5: this machine takes over the Telegram gateway if the primary goes quiet (lib/telegramFailover.ts) */
  failover: { enabled: boolean; primaryHost: string; minutes: number };
}
const DEFAULTS: TalosSettings = {
  notify: true,
  quietFrom: "22:00",
  quietTo: "07:00",
  digest: true,
  digestAt: "08:00",
  events: { results: true, failures: true, permissions: true, levelup: true, offline: true, limits: true },
  failover: { enabled: false, primaryHost: "", minutes: 10 },
};
const hhmm = (v: unknown, d: string) => (typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : d);

export async function readTalosSettings(): Promise<TalosSettings> {
  try {
    const j = JSON.parse(await fsp.readFile(SETTINGS, "utf8"));
    return {
      notify: j.notify !== false,
      quietFrom: hhmm(j.quietFrom, DEFAULTS.quietFrom),
      quietTo: hhmm(j.quietTo, DEFAULTS.quietTo),
      digest: j.digest !== false,
      digestAt: hhmm(j.digestAt, DEFAULTS.digestAt),
      events: { ...DEFAULTS.events, ...Object.fromEntries(Object.entries(j.events ?? {}).filter(([k, v]) => k in DEFAULTS.events && typeof v === "boolean")) },
      failover: { enabled: j.failover?.enabled === true, primaryHost: typeof j.failover?.primaryHost === "string" ? j.failover.primaryHost.slice(0, 80) : "", minutes: Math.min(60, Math.max(3, Number(j.failover?.minutes) || 10)) },
    };
  } catch {
    return JSON.parse(JSON.stringify(DEFAULTS));
  }
}
export async function saveTalosSettings(patch: Any): Promise<TalosSettings> {
  const cur = await readTalosSettings();
  const next: TalosSettings = {
    notify: typeof patch.notify === "boolean" ? patch.notify : cur.notify,
    quietFrom: hhmm(patch.quietFrom, cur.quietFrom),
    quietTo: hhmm(patch.quietTo, cur.quietTo),
    digest: typeof patch.digest === "boolean" ? patch.digest : cur.digest,
    digestAt: hhmm(patch.digestAt, cur.digestAt),
    events: { ...cur.events, ...Object.fromEntries(Object.entries(patch.events ?? {}).filter(([k, v]) => k in DEFAULTS.events && typeof v === "boolean")) },
    failover: {
      enabled: typeof patch.failover?.enabled === "boolean" ? patch.failover.enabled : cur.failover.enabled,
      primaryHost: typeof patch.failover?.primaryHost === "string" ? patch.failover.primaryHost.slice(0, 80) : cur.failover.primaryHost,
      minutes: patch.failover?.minutes !== undefined ? Math.min(60, Math.max(3, Number(patch.failover.minutes) || 10)) : cur.failover.minutes,
    },
  };
  await fsp.mkdir(DATA, { recursive: true });
  await fsp.writeFile(SETTINGS, JSON.stringify(next, null, 2), "utf8");
  return next;
}

// ─── pure parts (tested by scripts/test-talos.mjs) ───

const mins = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
/** Is local time `now` inside quiet hours (which may wrap past midnight)? */
export function inQuiet(now: Date, from: string, to: string): boolean {
  const m = now.getHours() * 60 + now.getMinutes(), a = mins(from), b = mins(to);
  return a === b ? false : a < b ? m >= a && m < b : m >= a || m < b;
}

export interface TalosEvent { key: string; text: string }
/** The events a snapshot holds (each with a stable key, so it is sent once). */
export function eventsFrom(snap: Any, s: TalosSettings, now = Date.now()): TalosEvent[] {
  const out: TalosEvent[] = [];
  const e = s.events;
  for (const w of snap.work ?? []) {
    if (e.results) for (const t of w.review ?? []) out.push({ key: `review:${t.id}`, text: `✅ Ready for your review: ${t.title} (${t.who}${t.repo && t.repo !== "levelup" ? ` · ${t.repo}` : ""})` });
    if (e.levelup) for (const t of w.levelupWaitingApproval ?? []) out.push({ key: `lu:${t.id}`, text: `🗂 LevelUp hand-off waiting for your approval: ${t.title}${t.who && t.who !== "nobody" ? ` (plan: ${t.who})` : ""}. Reply "approve it" or open LevelUp → Fleet.` });
  }
  if (e.failures) for (const j of snap.jobs?.failedLast24h ?? []) out.push({ key: `fail:${j.id}`, text: `⚠️ Didn't finish on ${j.machine}: ${j.mode}${j.error ? ` — ${j.error}` : ""}` });
  if (e.permissions) for (const p of snap.permissionPrompts ?? []) out.push({ key: `perm:${p.host}:${p.id}`, text: `🔐 ${p.tool ?? "An AI"} on ${p.machine} asks permission${p.project ? ` in ${p.project}` : ""}: ${p.what}. Reply allow or deny.` });
  if (e.offline)
    for (const m of snap.machines ?? []) {
      if (!m.online && (m.lastSeenMinutesAgo ?? 0) >= 10) out.push({ key: `off:${m.host}:${Math.floor((now - (m.lastSeenMinutesAgo ?? 0) * 60000) / 3600000)}`, text: `📴 ${m.label} has been offline for ${m.lastSeenMinutesAgo} minutes.` });
    }
  if (e.limits)
    for (const m of snap.machines ?? [])
      for (const sub of m.subscriptions ?? [])
        if (sub.status === "limited") out.push({ key: `limit:${m.host}:${sub.tool}:${sub.resetsAt ?? ""}`, text: `⏳ ${sub.tool} hit its limit on ${m.label}${sub.resetsAt ? `; resets ${new Date(sub.resetsAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}.` });
  return out;
}

/** The morning digest (plain text, no AI). */
export function digestText(snap: Any): string {
  const ms = snap.machines ?? [];
  const up = ms.filter((m: Any) => m.online).length;
  const down = ms.filter((m: Any) => !m.online).map((m: Any) => m.label);
  const lines = [`☀️ Mission Control this morning`, `Machines: ${up} of ${ms.length} up${down.length ? ` (down: ${down.join(", ")})` : ""}${snap.pause?.paused ? " · the fleet is PAUSED" : ""}`];
  for (const w of snap.work ?? []) {
    const who = Object.entries(w.byWho ?? {}).sort((a: Any, b: Any) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k} ${v}`).join(", ");
    lines.push(`Work (${w.heldBy}): ${w.open} open — ${who}; ${w.byStatus?.review ?? 0} to review, ${w.byStatus?.doing ?? 0} in progress${w.levelupWaitingApproval?.length ? `; ${w.levelupWaitingApproval.length} LevelUp hand-off(s) waiting for approval` : ""}`);
  }
  if (snap.approvals?.length) lines.push(`Approvals waiting: ${snap.approvals.length}`);
  if (snap.permissionPrompts?.length) lines.push(`Permission prompts waiting: ${snap.permissionPrompts.length}`);
  const runs = (snap.runs ?? []).filter((r: Any) => !["done", "failed", "stopped"].includes(r.status));
  if (runs.length) lines.push(`Runs going: ${runs.map((r: Any) => `${r.title} (${r.status}, ${r.done}/${r.tasks})`).join("; ")}`);
  const failed = snap.jobs?.failedLast24h?.length ?? 0;
  if (failed) lines.push(`Didn't finish in the last 24 h: ${failed}`);
  const badSched = (snap.schedules ?? []).filter((x: Any) => x.enabled && x.lastStatus && !/^(ok|done|success)/i.test(x.lastStatus));
  if (badSched.length) lines.push(`Schedules with a problem: ${badSched.map((x: Any) => `${x.title} (${x.lastStatus})`).join("; ")}`);
  const limited = ms.flatMap((m: Any) => (m.subscriptions ?? []).filter((x: Any) => x.status === "limited").map((x: Any) => `${x.tool} on ${m.label}`));
  if (limited.length) lines.push(`At their limit: ${limited.join(", ")}`);
  if (snap.github?.waiting) lines.push(`GitHub waiting on you: ${snap.github.waiting}`);
  if (snap.notReachedOverLan?.length) lines.push(`Couldn't reach over the LAN: ${snap.notReachedOverLan.join(", ")}`);
  lines.push(`Ask me anything about it, or tell me what to do.`);
  return lines.join("\n");
}

// ─── the tick (master only, scheduler instance) ───

interface NotifyState { seeded: boolean; seen: Record<string, number>; held: string[]; lastDigest?: string }
async function readState(): Promise<NotifyState> {
  try {
    const j = JSON.parse(await fsp.readFile(STATE, "utf8"));
    return { seeded: !!j.seeded, seen: j.seen ?? {}, held: Array.isArray(j.held) ? j.held : [], lastDigest: j.lastDigest };
  } catch {
    return { seeded: false, seen: {}, held: [] };
  }
}
async function writeState(s: NotifyState) {
  const cut = Date.now() - 14 * 24 * 3600e3;
  s.seen = Object.fromEntries(Object.entries(s.seen).filter(([, t]) => t > cut));
  s.held = s.held.slice(-40);
  await fsp.mkdir(DATA, { recursive: true });
  await fsp.writeFile(STATE, JSON.stringify(s), "utf8");
}

let busy = false;
let lastRun = 0;
export async function talosNotifyTick(): Promise<void> {
  if (busy || Date.now() - lastRun < 110_000) return;
  busy = true;
  lastRun = Date.now();
  try {
    const { clusterStatus } = await import("./cluster");
    const st: Any = await clusterStatus().catch(() => null);
    if (!st?.masterIsSelf && st?.config?.enabled) return; // the master sends (it holds the bot token)
    const settings = await readTalosSettings();
    if (!settings.notify && !settings.digest) return;
    const { buildSnapshot } = await import("./fleetSnapshot");
    const { sendTelegram } = await import("./telegram");
    const snap = await buildSnapshot();
    const state = await readState();
    const now = new Date();
    const quiet = inQuiet(now, settings.quietFrom, settings.quietTo);
    const fresh = eventsFrom(snap, settings).filter((ev) => !state.seen[ev.key]);
    for (const ev of fresh) state.seen[ev.key] = Date.now();
    if (state.seeded && settings.notify && fresh.length) {
      if (quiet) state.held.push(...fresh.map((f) => f.text));
      else {
        const text = fresh.length > 6 ? `${fresh.slice(0, 6).map((f) => f.text).join("\n")}\n…and ${fresh.length - 6} more. Ask me for the rest.` : fresh.map((f) => f.text).join("\n");
        await sendTelegram(text);
      }
    }
    state.seeded = true;
    const today = now.toISOString().slice(0, 10);
    if (settings.digest && state.lastDigest !== today && now.getHours() * 60 + now.getMinutes() >= mins(settings.digestAt) && !quiet) {
      const held = state.held.length ? `\n\nWhile it was quiet:\n${state.held.slice(-10).join("\n")}${state.held.length > 10 ? `\n…and ${state.held.length - 10} more` : ""}` : "";
      if (await sendTelegram(digestText(snap) + held)) {
        state.lastDigest = today;
        state.held = [];
      }
    } else if (!quiet && state.held.length && settings.notify && state.lastDigest === today) {
      await sendTelegram(`While it was quiet:\n${state.held.slice(-10).join("\n")}`);
      state.held = [];
    }
    await writeState(state);
  } catch (e) {
    console.warn("[talos] notify:", (e as Error).message);
  } finally {
    busy = false;
  }
}
