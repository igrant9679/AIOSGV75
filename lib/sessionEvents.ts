import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import readline from "readline";
import { readConfig, isMasterNow } from "./cluster";
import { vaultAvailable, vaultInfo } from "./vault";
import { sessionsSnapshot, cleanPromptText, textOf, type SessionSummary, type SessionTool } from "./sessions";
import { broadcastPeers } from "./peer";
import { sendTelegram } from "./telegram";
import { hookStatus, installHooks, removeHooks } from "./hooks";

/**
 * Session events from Claude Code hooks and Codex's notify program
 * (scripts/mc-hook.mjs), on every machine:
 *
 *   waiting   a session needs you (permission prompt, or waiting for input)
 *   finished  a session finished a turn (how long it took, files changed)
 *   ended     a session was closed
 *
 * They feed Command → Needs you: open "waiting" events, plus turns that ran
 * long (default 5+ minutes) - from every machine. Events travel to the other
 * machines over the LAN at once (lib/peer.ts) and through the vault
 * (Agentic OS/Cluster/events/<host>.json) for Off-LAN machines.
 *
 * Settings shared by every machine: Agentic OS/Cluster/session-alerts.json.
 */

export type EventKind = "waiting" | "finished" | "ended";

export interface SessionEvent {
  id: string;
  host: string;
  hostLabel: string;
  kind: EventKind;
  tool: SessionTool;
  key: string;
  title: string;
  project: string;
  cwd: string;
  message: string;
  ts: number;
  /** finished: how long the turn ran, and what it did */
  turnMs?: number;
  filesChanged?: number;
  toolCalls?: number;
  long?: boolean;
}

export interface AlertSettings {
  /** keep the hook installed on every machine */
  hooks: boolean;
  /** a finished turn this long (minutes) is worth telling you about */
  longMinutes: number;
  telegram: { waiting: boolean; longFinished: boolean; daily: boolean; permissions?: boolean };
  /**
   * Permission prompts answered from the app (Claude Code's PermissionRequest hook):
   *  off - never; app - the app's own runs (replies, new sessions) wait for your answer;
   *  all - terminal sessions too: they wait waitSeconds for an answer from the app, then
   *        fall back to the normal prompt in the terminal.
   */
  permissions: { mode: "off" | "app" | "all"; waitSeconds: number };
}

const DEFAULTS: AlertSettings = {
  hooks: true,
  longMinutes: 5,
  telegram: { waiting: false, longFinished: false, daily: false, permissions: false },
  permissions: { mode: "app", waitSeconds: 60 },
};
const STORE = path.join(process.cwd(), "data", "session-events.json");
const SPOOL = path.join(process.cwd(), "data", "hook-spool.jsonl");
const SENT = path.join(process.cwd(), "data", "alerts-sent.json");
const WAITING_EXPIRES_MS = 6 * 60 * 60_000;
const NEEDS_WINDOW_MS = 24 * 60 * 60_000;

const me = () => os.hostname();
const clusterDir = () => path.join(vaultInfo().base, "Cluster");
const settingsFile = () => path.join(clusterDir(), "session-alerts.json");
const eventsDir = () => path.join(clusterDir(), "events");

// ─── settings ───

export async function readAlertSettings(): Promise<AlertSettings> {
  try {
    const f = JSON.parse(await fsp.readFile(settingsFile(), "utf8")) as Partial<AlertSettings>;
    return { ...DEFAULTS, ...f, telegram: { ...DEFAULTS.telegram, ...(f.telegram ?? {}) }, permissions: { ...DEFAULTS.permissions, ...(f.permissions ?? {}) } };
  } catch {
    return { ...DEFAULTS, telegram: { ...DEFAULTS.telegram }, permissions: { ...DEFAULTS.permissions } };
  }
}

export async function writeAlertSettings(
  patch: Omit<Partial<AlertSettings>, "telegram" | "permissions"> & { telegram?: Partial<AlertSettings["telegram"]>; permissions?: Partial<AlertSettings["permissions"]> },
): Promise<AlertSettings> {
  const cur = await readAlertSettings();
  const p = patch.permissions ?? {};
  const next: AlertSettings = {
    hooks: typeof patch.hooks === "boolean" ? patch.hooks : cur.hooks,
    longMinutes: typeof patch.longMinutes === "number" && patch.longMinutes >= 1 && patch.longMinutes <= 240 ? Math.round(patch.longMinutes) : cur.longMinutes,
    telegram: { ...cur.telegram, ...(patch.telegram ?? {}) },
    permissions: {
      mode: p.mode === "off" || p.mode === "app" || p.mode === "all" ? p.mode : cur.permissions.mode,
      waitSeconds: typeof p.waitSeconds === "number" && p.waitSeconds >= 10 && p.waitSeconds <= 600 ? Math.round(p.waitSeconds) : cur.permissions.waitSeconds,
    },
  };
  if (!(await vaultAvailable())) throw new Error("The vault isn't available, so the shared alert settings can't be saved.");
  await fsp.mkdir(clusterDir(), { recursive: true });
  await fsp.writeFile(settingsFile(), JSON.stringify(next, null, 2), "utf8");
  if (typeof patch.hooks === "boolean") await (patch.hooks ? installHooks() : removeHooks()).catch(() => {});
  return next;
}

// ─── store ───

interface Store {
  own: SessionEvent[];
  remote: SessionEvent[];
  dismissed: Record<string, number>;
}

async function readStore(): Promise<Store> {
  try {
    const s = JSON.parse(await fsp.readFile(STORE, "utf8")) as Store;
    return { own: s.own ?? [], remote: s.remote ?? [], dismissed: s.dismissed ?? {} };
  } catch {
    return { own: [], remote: [], dismissed: {} };
  }
}

let chain: Promise<unknown> = Promise.resolve();
function mutate<T>(fn: (s: Store) => T): Promise<T> {
  const run = chain.then(async () => {
    const s = await readStore();
    const out = fn(s);
    s.own = s.own.sort((a, b) => b.ts - a.ts).slice(0, 300);
    s.remote = s.remote.sort((a, b) => b.ts - a.ts).slice(0, 500);
    const cutoff = Date.now() - 3 * NEEDS_WINDOW_MS;
    for (const [id, at] of Object.entries(s.dismissed)) if (at < cutoff) delete s.dismissed[id];
    await fsp.mkdir(path.dirname(STORE), { recursive: true });
    const tmp = `${STORE}.${process.pid}.${Date.now()}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(s), "utf8");
    await fsp.rename(tmp, STORE);
    return out;
  });
  chain = run.catch(() => {});
  return run;
}

export async function ownEvents(limit = 80): Promise<SessionEvent[]> {
  return (await readStore()).own.slice(0, limit);
}

// ─── from the hook ───

interface TurnStats {
  turnMs?: number;
  filesChanged: number;
  toolCalls: number;
  lastText: string;
}

/** What the last turn of a Claude Code session did, from the end of its transcript. */
async function claudeTurnStats(file: string, at: number): Promise<TurnStats> {
  const st = await fsp.stat(file).catch(() => null);
  const out: TurnStats = { filesChanged: 0, toolCalls: 0, lastText: "" };
  if (!st) return out;
  const start = Math.max(0, st.size - 3 * 1024 * 1024);
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: "utf8", start }), crlfDelay: Infinity });
  let turnStart = 0;
  let files = new Set<string>();
  let calls = 0;
  let text = "";
  let first = start > 0;
  for await (const line of rl) {
    if (first) {
      first = false; // a partial line
      continue;
    }
    if (!line.includes('"type":"user"') && !line.includes('"type":"assistant"')) continue;
    let o: { type?: string; isMeta?: boolean; isSidechain?: boolean; timestamp?: string; message?: { content?: unknown } };
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (o.isSidechain || o.isMeta || !o.message) continue;
    const c = o.message.content;
    if (o.type === "user") {
      if (Array.isArray(c) && c.some((x) => (x as { type?: string })?.type === "tool_result")) continue;
      if (!cleanPromptText(textOf(c))) continue;
      // a new prompt: the turn starts here
      turnStart = o.timestamp ? Date.parse(o.timestamp) : 0;
      files = new Set();
      calls = 0;
      text = "";
    } else if (o.type === "assistant" && Array.isArray(c)) {
      for (const x of c as { type?: string; text?: string; name?: string; input?: { file_path?: string; notebook_path?: string } }[]) {
        if (x?.type === "text" && x.text?.trim()) text = x.text.trim();
        if (x?.type === "tool_use") {
          calls++;
          if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(x.name ?? "")) {
            const f = x.input?.file_path ?? x.input?.notebook_path;
            if (f) files.add(f);
          }
        }
      }
    }
  }
  return { turnMs: turnStart ? Math.max(0, at - turnStart) : undefined, filesChanged: files.size, toolCalls: calls, lastText: text };
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** One event from scripts/mc-hook.mjs (or the spool). */
export async function ingestHook(body: { source?: string; payload?: Record<string, unknown>; at?: number }): Promise<SessionEvent | null> {
  const p = body.payload ?? {};
  const at = typeof body.at === "number" ? body.at : Date.now();
  const tool: SessionTool = body.source === "codex" ? "codex" : "claude";
  let kind: EventKind;
  let sessionId: string;
  let message = "";
  let stats: TurnStats | undefined;
  const cwd = String(p.cwd ?? "");

  if (tool === "claude") {
    const ev = String(p.hook_event_name ?? "");
    sessionId = String(p.session_id ?? "");
    if (ev === "Notification") {
      message = String(p.message ?? "Waiting for you");
      // "waiting for your input" after an idle minute just repeats the Stop event - only real asks count
      if (p.notification_type === "idle_prompt" || /waiting for your input/i.test(message)) return null;
      kind = "waiting";
    } else if (ev === "Stop") {
      if (p.stop_hook_active) return null;
      kind = "finished";
      if (typeof p.transcript_path === "string") stats = await claudeTurnStats(p.transcript_path, at).catch(() => undefined);
      message = stats?.lastText ?? "";
    } else if (ev === "SessionEnd") {
      kind = "ended";
      message = `Closed${p.reason ? ` (${String(p.reason)})` : ""}`;
    } else return null;
  } else {
    if (p.type !== "agent-turn-complete") return null;
    kind = "finished";
    sessionId = String(p["thread-id"] ?? p.thread_id ?? "");
    message = String(p["last-assistant-message"] ?? "");
  }
  if (!/^[\w-]{6,80}$/.test(sessionId)) return null;

  const key = `${tool}:${sessionId}`;
  const [snap, cfg, settings] = await Promise.all([sessionsSnapshot().catch(() => null), readConfig().catch(() => null), readAlertSettings()]);
  const s: SessionSummary | undefined = snap?.sessions.find((x) => x.key === key);
  const ev: SessionEvent = {
    id: `ev-${at.toString(36)}-${sessionId.slice(0, 8)}-${kind[0]}`,
    host: me(),
    hostLabel: cfg?.label || me(),
    kind,
    tool,
    key,
    title: s?.title ?? (cwd ? path.basename(cwd) : "Session"),
    project: s?.project ?? (cwd ? path.basename(cwd) : ""),
    cwd: cwd || s?.cwd || "",
    message: clip(message.replace(/\s+/g, " ").trim(), 400),
    ts: at,
    turnMs: stats?.turnMs,
    filesChanged: stats?.filesChanged,
    toolCalls: stats?.toolCalls,
  };
  ev.long = kind === "finished" && (ev.turnMs ?? 0) >= settings.longMinutes * 60_000;
  await mutate((st) => {
    if (!st.own.some((e) => e.id === ev.id)) st.own.unshift(ev);
  });
  void broadcastPeers("/peer/event", { events: [ev] }).catch(() => {});
  schedulePublish();
  return ev;
}

/** Events pushed by another machine over the LAN. */
export async function ingestRemote(events: SessionEvent[]): Promise<boolean> {
  const good = (events ?? []).filter((e) => e && typeof e.id === "string" && typeof e.host === "string" && e.host !== me() && typeof e.ts === "number").slice(0, 50);
  if (!good.length) return true;
  await mutate((st) => {
    for (const e of good) if (!st.remote.some((x) => x.id === e.id)) st.remote.unshift(e);
  });
  return true;
}

export async function dismissEvents(ids: string[]): Promise<void> {
  await mutate((st) => {
    for (const id of ids) st.dismissed[id] = Date.now();
  });
}

// ─── to the vault (Off-LAN machines) ───

let publishTimer: NodeJS.Timeout | null = null;
function schedulePublish(): void {
  if (publishTimer) return;
  publishTimer = setTimeout(() => {
    publishTimer = null;
    void publishEvents().catch(() => {});
  }, 20_000);
}

async function publishEvents(): Promise<void> {
  const cfg = await readConfig().catch(() => null);
  if (!cfg?.enabled || !(await vaultAvailable())) return;
  const own = (await readStore()).own.slice(0, 100);
  await fsp.mkdir(eventsDir(), { recursive: true });
  const file = path.join(eventsDir(), `${me().replace(/[^A-Za-z0-9_-]+/g, "_")}.json`);
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify({ host: me(), at: Date.now(), events: own }), "utf8");
  await fsp.rename(tmp, file);
}

async function vaultEvents(): Promise<SessionEvent[]> {
  if (!(await vaultAvailable())) return [];
  const names = await fsp.readdir(eventsDir()).catch(() => [] as string[]);
  const out: SessionEvent[] = [];
  for (const n of names) {
    if (!n.endsWith(".json")) continue;
    try {
      const f = JSON.parse(await fsp.readFile(path.join(eventsDir(), n), "utf8")) as { host?: string; events?: SessionEvent[] };
      if (!f.host || f.host === me()) continue;
      out.push(...(f.events ?? []));
    } catch {
      /* mid-sync */
    }
  }
  return out;
}

/** Every event any machine reported between two times (daily summary). */
export async function eventsBetween(from: number, to: number): Promise<SessionEvent[]> {
  const [st, vault] = await Promise.all([readStore(), vaultEvents()]);
  const byId = new Map<string, SessionEvent>();
  for (const e of [...st.own, ...st.remote, ...vault]) if (e?.id && e.ts >= from && e.ts < to && !byId.has(e.id)) byId.set(e.id, e);
  return [...byId.values()].sort((a, b) => a.ts - b.ts);
}

// ─── the view ───

export interface NeedsItem extends SessionEvent {
  reason: "waiting" | "long";
}

export interface EventsView {
  needs: NeedsItem[];
  recent: SessionEvent[];
  settings: AlertSettings;
}

/**
 * Everything every machine reported, merged. A "waiting" event stays open
 * until a later event from that session (it moved on), the session is no
 * longer waiting, 6 hours pass, or you dismiss it. `sessions` (the merged
 * session list) lets it check current status.
 */
export async function eventsView(sessions?: SessionSummary[], extra: SessionEvent[] = []): Promise<EventsView> {
  const [st, vault, settings] = await Promise.all([readStore(), vaultEvents(), readAlertSettings()]);
  const byId = new Map<string, SessionEvent>();
  for (const e of [...st.own, ...st.remote, ...vault, ...extra]) if (e?.id && !byId.has(e.id)) byId.set(e.id, e);
  const all = [...byId.values()].sort((a, b) => b.ts - a.ts);
  const latestByKey = new Map<string, number>();
  for (const e of all) latestByKey.set(`${e.host}|${e.key}`, Math.max(latestByKey.get(`${e.host}|${e.key}`) ?? 0, e.ts));
  const status = new Map((sessions ?? []).map((s) => [s.key, s]));
  const now = Date.now();
  const needs: NeedsItem[] = [];
  for (const e of all) {
    if (st.dismissed[e.id] || now - e.ts > NEEDS_WINDOW_MS) continue;
    const movedOn = (latestByKey.get(`${e.host}|${e.key}`) ?? 0) > e.ts;
    if (e.kind === "waiting") {
      const s = status.get(e.key);
      const stillWaiting = !movedOn && now - e.ts < WAITING_EXPIRES_MS && (!s || s.status === "waiting" || s.status === "idle" || s.updatedAt <= e.ts + 5_000);
      if (stillWaiting) needs.push({ ...e, reason: "waiting" });
    } else if (e.kind === "finished" && e.long && !movedOn) {
      needs.push({ ...e, reason: "long" });
    }
  }
  return { needs, recent: all.slice(0, 60), settings };
}

// ─── background duties ───

/** Pick up events the hook spooled while Mission Control was down. */
export async function drainSpool(): Promise<void> {
  const text = await fsp.readFile(SPOOL, "utf8").catch(() => "");
  if (!text.trim()) return;
  await fsp.writeFile(SPOOL, "", "utf8");
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      await ingestHook(JSON.parse(line));
    } catch {
      /* bad line */
    }
  }
}

let lastHookCheck = 0;
/** Keep the hook installed (or removed) here, per the shared setting. Every 10 minutes. */
export async function maintainHooks(force = false): Promise<void> {
  if (!force && Date.now() - lastHookCheck < 10 * 60_000) return;
  lastHookCheck = Date.now();
  const settings = await readAlertSettings();
  const st = await hookStatus();
  if (settings.hooks && (st.claude === "missing" || st.claude === "outdated" || st.codex === "missing" || st.codex === "outdated")) await installHooks();
  if (!settings.hooks && (st.claude !== "missing" || st.codex === "installed" || st.codex === "outdated")) await removeHooks();
}

/** Master only: Telegram pings for new needs-you items, when turned on. */
export async function alertsTick(sessions: SessionSummary[]): Promise<void> {
  if (!(await isMasterNow())) return;
  const view = await eventsView(sessions);
  const t = view.settings.telegram;
  if (!t.waiting && !t.longFinished) return;
  let sent: string[] | null = null;
  try {
    sent = JSON.parse(await fsp.readFile(SENT, "utf8")) as string[];
  } catch {
    sent = null;
  }
  // first run: don't flood you with everything that's already open
  if (!sent) {
    await fsp.writeFile(SENT, JSON.stringify(view.needs.map((n) => n.id)), "utf8");
    return;
  }
  const fresh = view.needs.filter((n) => !sent!.includes(n.id) && ((n.reason === "waiting" && t.waiting) || (n.reason === "long" && t.longFinished)));
  for (const n of fresh) {
    const mins = n.turnMs ? Math.round(n.turnMs / 60_000) : 0;
    const text =
      n.reason === "waiting"
        ? `⏳ ${n.hostLabel} · ${n.title}\n${n.message}`
        : `✅ ${n.hostLabel} · ${n.title} finished after ${mins} min${n.filesChanged ? ` · ${n.filesChanged} files changed` : ""}\n${clip(n.message, 300)}`;
    await sendTelegram(text).catch(() => false);
    sent.push(n.id);
  }
  if (fresh.length) await fsp.writeFile(SENT, JSON.stringify(sent.slice(-500)), "utf8");
}
