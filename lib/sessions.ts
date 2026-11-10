import fs from "fs";
import { productName } from "./netSettings";
import fsp from "fs/promises";
import path from "path";
import os from "os";
import readline from "readline";
import zlib from "zlib";
import {
  UNSORTED,
  desktopAppTitles,
  folderProject,
  inferWorkDir,
  tallyDirs,
  jobTitle,
  pathsIn,
  prettyProject,
  readJobDefs,
  type ProjectSource,
  type TitleSource,
} from "./projectNames";
import { readNames } from "./sessionNaming";

/**
 * Native session reader — the "capture" layer of the second brain. Reads the
 * session files that Claude Code and Codex write on THIS machine, including
 * sessions that never went through Mission Control (terminal, desktop app,
 * IDE). Read-only: nothing here writes to ~/.claude or ~/.codex.
 *
 *   Claude Code  ~/.claude/projects/<encoded-cwd>/<session-id>.jsonl
 *                ~/.claude/sessions/<pid>.json   (one per open process: status)
 *   Codex        ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl(.zst)
 *                ~/.codex/session_index.jsonl  (thread titles)
 *
 * Claude history can run to gigabytes, so summaries are cached by
 * path + mtime + size in data/sessions-cache.json (derived, per-machine,
 * rebuildable — unlike the data/*.json sources of truth, a stale read is
 * impossible because the key changes whenever the file does). Each request
 * parses newest-first within a time budget; anything left over appears as a
 * lightweight "indexing" stub and is picked up by the next request.
 *
 * Credentials are never read: only ~/.claude.json's account label, never
 * ~/.claude/.credentials.json or ~/.codex/auth.json.
 */

export type SessionTool = "claude" | "codex";
export type SessionStatus = "running" | "waiting" | "idle" | "ended";

export interface SessionSummary {
  key: string; // `${tool}:${id}`
  id: string;
  tool: SessionTool;
  title: string;
  cwd: string;
  project: string; // basename of cwd
  host: string;
  startedAt: number;
  updatedAt: number;
  userTurns: number;
  tokensIn: number;
  tokensOut: number;
  tokensCached: number;
  model?: string;
  origin?: string; // claude-desktop, sdk-cli, Codex Desktop, …
  /** cleaned first human prompt (also used to recognize Mission Control jobs) */
  firstPrompt?: string;
  /** names recorded in the session file itself */
  aiTitle?: string;
  customTitle?: string;
  /** folders this session read or edited, with counts (cache only — see projectNames.tallyDirs) */
  touchedDirs?: [string, number][];
  /** where `project` / `title` came from — see lib/projectNames.ts */
  projectSource?: ProjectSource;
  titleSource?: TitleSource;
  /** the folder behind `project`, when there is one */
  folder?: string;
  /** desktop app only: when you last had this session open */
  lastOpenedAt?: number;
  /** hidden from the Projects page by you (data/session-names.json) */
  hidden?: boolean;
  status: SessionStatus;
  indexing?: boolean; // true = stub, full parse still pending
}

export interface SubscriptionMeter {
  id: string;
  tool: SessionTool | "kimi";
  label: string;
  plan?: string;
  /** 0-100 when the tool reports it; undefined = no limit data available */
  usedPercent?: number;
  windowLabel?: string;
  resetsAt?: number;
  /** tokens used in the trailing 5 hours / 7 days (from local sessions) */
  tokens5h: number;
  tokens7d: number;
  status: "ok" | "near" | "limited" | "unknown" | "not_set_up";
  note: string;
  observedAt?: number;
}

const HOME = os.homedir();
const CLAUDE_PROJECTS = path.join(HOME, ".claude", "projects");
const CLAUDE_LIVE = path.join(HOME, ".claude", "sessions");
const CLAUDE_JSON = path.join(HOME, ".claude.json");
const CODEX_SESSIONS = path.join(HOME, ".codex", "sessions");
const CODEX_INDEX = path.join(HOME, ".codex", "session_index.jsonl");
const CACHE_FILE = path.join(process.cwd(), "data", "sessions-cache.json");
const CACHE_VERSION = 5; // bump when parsing changes, so cached summaries are re-read
const PARSE_BUDGET_MS = 6_000;
const RUNNING_WINDOW_MS = 3 * 60_000;

interface CachedEntry {
  sig: string; // mtimeMs:size
  summary: Omit<SessionSummary, "status" | "host">;
  /** codex only: the newest rate-limit snapshot seen in this file */
  rateLimits?: CodexRateLimits;
  /** codex only: a turn started and never completed/aborted */
  openTurn?: boolean;
  /** usage samples for trailing-window meters: [ts, tokens] */
  samples?: [number, number][];
}

interface CodexRateLimits {
  ts: number;
  plan?: string;
  primary?: { used_percent: number; window_minutes: number; resets_at: number } | null;
  secondary?: { used_percent: number; window_minutes: number; resets_at: number } | null;
  reached?: string | null;
}

interface CacheFile {
  v: number;
  entries: Record<string, CachedEntry>;
}

let parsing: Promise<void> | null = null;

async function readCache(): Promise<CacheFile> {
  try {
    const c = JSON.parse(await fsp.readFile(CACHE_FILE, "utf8")) as CacheFile;
    if (c.v === CACHE_VERSION && c.entries) return c;
  } catch {
    /* first run or corrupt — rebuild */
  }
  return { v: CACHE_VERSION, entries: {} };
}

/**
 * Merge this pass's results into whatever is on disk NOW, then swap the file
 * in atomically. Route handlers can run as separate module instances (see
 * AGENTS.md rule 1), so two parse passes may overlap; merging keeps one from
 * erasing the other's work.
 */
async function mergeCache(updates: Record<string, CachedEntry>, removed: string[]): Promise<void> {
  const disk = await readCache();
  Object.assign(disk.entries, updates);
  for (const k of removed) delete disk.entries[k];
  await fsp.mkdir(path.dirname(CACHE_FILE), { recursive: true });
  const tmp = `${CACHE_FILE}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(disk), "utf8");
  try {
    await fsp.rename(tmp, CACHE_FILE);
  } catch {
    await fsp.unlink(tmp).catch(() => {}); // another pass won the race; its data is a superset next time
  }
}

// ─── file discovery ───

interface Found {
  file: string;
  tool: SessionTool;
  sig: string;
  mtimeMs: number;
}

async function statSig(file: string): Promise<{ sig: string; mtimeMs: number } | null> {
  try {
    const s = await fsp.stat(file);
    return { sig: `${Math.round(s.mtimeMs)}:${s.size}`, mtimeMs: s.mtimeMs };
  } catch {
    return null;
  }
}

async function findClaudeFiles(): Promise<Found[]> {
  const out: Found[] = [];
  let dirs: string[] = [];
  try {
    dirs = await fsp.readdir(CLAUDE_PROJECTS);
  } catch {
    return out;
  }
  for (const d of dirs) {
    let names: string[] = [];
    try {
      names = await fsp.readdir(path.join(CLAUDE_PROJECTS, d));
    } catch {
      continue;
    }
    for (const n of names) {
      if (!n.endsWith(".jsonl")) continue;
      const file = path.join(CLAUDE_PROJECTS, d, n);
      const st = await statSig(file);
      if (st) out.push({ file, tool: "claude", ...st });
    }
  }
  return out;
}

async function walk(dir: string): Promise<string[]> {
  let entries: fs.Dirent[] = [];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (/^rollout-.*\.jsonl(\.zst)?$/.test(e.name)) out.push(p);
  }
  return out;
}

async function findCodexFiles(): Promise<Found[]> {
  const out: Found[] = [];
  for (const file of await walk(CODEX_SESSIONS)) {
    const st = await statSig(file);
    if (st) out.push({ file, tool: "codex", ...st });
  }
  return out;
}

// ─── helpers ───

function projectOf(cwd: string): string {
  if (!cwd) return "(no folder)";
  const trimmed = cwd.replace(/[\\/]+$/, "");
  // Sessions started in a user's home folder aren't a project — say so.
  const home = trimmed.match(/[\\/](?:Users|home)[\\/]([^\\/]+)$/i);
  if (home) return `Home folder (${home[1]})`;
  const base = path.basename(trimmed);
  return base || cwd;
}

function codexPlanName(plan?: string): string | undefined {
  if (!plan) return undefined;
  const known: Record<string, string> = { prolite: "Pro Lite", pro: "Pro", plus: "Plus", team: "Team", business: "Business", enterprise: "Enterprise", free: "Free", edu: "Edu" };
  return known[plan.toLowerCase()] ?? plan;
}

/** Last line of Mission Control's own context preamble (lib/retrieval.ts memoryBlock). */
const MC_PREAMBLE_END = "[OS verbs — include these tags";

/** First line of a human prompt, with injected reminder/context blocks removed. */
function cleanPrompt(text: string): string {
  const stripped = cleanPromptText(text);
  const first =
    stripped
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l && !/^(#|---|\[.*\]$)/.test(l)) ?? "";
  return first.replace(/^\*\*|\*\*$/g, "").slice(0, 140);
}

/** The whole human prompt with Mission Control's preamble and injected context blocks removed. */
export function cleanPromptText(text: string): string {
  let body = text;
  // Runs launched by Mission Control carry profile/memory/vault context first;
  // the real request starts after the OS-verbs hint line.
  const pre = body.indexOf(MC_PREAMBLE_END);
  if (pre >= 0) {
    const nl = body.indexOf("\n", pre);
    body = nl >= 0 ? body.slice(nl + 1) : "";
  }
  // Injected context blocks (<system-reminder>, Codex's <environment_context>,
  // <recommended_plugins>…): match open/close by tag name so nested tags
  // can't leak, then drop any leftover tag-only lines.
  let stripped = body;
  for (let i = 0; i < 4; i++) {
    const next = stripped.replace(/<([a-z][\w-]*)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi, "");
    if (next === stripped) break;
    stripped = next;
  }
  stripped = stripped
    .split(/\r?\n/)
    .filter((l) => !/^\s*<\/?[a-z][\w-]*[^>]*>\s*$/i.test(l))
    .join("\n")
    .trim();
  return stripped;
}

export function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (c && typeof c === "object" && "text" in c && typeof (c as { text: unknown }).text === "string" ? (c as { text: string }).text : ""))
      .join("\n");
  }
  return "";
}

function idFromFile(file: string): string {
  const base = path.basename(file).replace(/\.jsonl(\.zst)?$/, "");
  const m = base.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  return m ? m[1] : base;
}

// ─── Claude parser ───

const CLAUDE_WANTED = ['"type":"user"', '"type":"assistant"', '"type":"ai-title"', '"type":"custom-title"'];

async function parseClaude(file: string): Promise<CachedEntry["summary"] & { samples: [number, number][] }> {
  const id = idFromFile(file);
  let cwd = "";
  let firstPrompt = "";
  let aiTitle = "";
  let customTitle = "";
  let startedAt = 0;
  let updatedAt = 0;
  let userTurns = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  let tokensCached = 0;
  let model: string | undefined;
  let origin: string | undefined;
  const seen = new Set<string>();
  const samples: [number, number][] = [];
  const touched: string[] = [];

  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line || !CLAUDE_WANTED.some((w) => line.includes(w))) continue;
    // Tool results are user-typed lines carrying file dumps — skip the parse.
    const isUserLine = line.includes('"type":"user"') && !line.includes('"type":"assistant"');
    if (isUserLine && (line.includes('"toolUseResult"') || line.includes('"sourceToolAssistantUUID"'))) continue;
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const type = o.type;
    if (type === "ai-title" && typeof o.aiTitle === "string") {
      aiTitle = o.aiTitle;
      continue;
    }
    if (type === "custom-title" && typeof o.customTitle === "string") {
      customTitle = o.customTitle;
      continue;
    }
    if (o.isSidechain) continue;
    const ts = typeof o.timestamp === "string" ? Date.parse(o.timestamp) : 0;
    if (ts) {
      if (!startedAt || ts < startedAt) startedAt = ts;
      if (ts > updatedAt) updatedAt = ts;
    }
    if (!cwd && typeof o.cwd === "string") cwd = o.cwd;
    if (!origin && typeof o.entrypoint === "string") origin = o.entrypoint;
    const msg = o.message as { role?: string; content?: unknown; usage?: Record<string, number>; model?: string; id?: string } | undefined;
    if (type === "user" && !o.isMeta && msg) {
      const content = msg.content;
      const isToolResult = Array.isArray(content) && content.some((c) => c && typeof c === "object" && (c as { type?: string }).type === "tool_result");
      if (isToolResult) continue;
      const prompt = cleanPrompt(textOf(content));
      if (!prompt) continue;
      userTurns++;
      if (!firstPrompt) firstPrompt = prompt;
      continue;
    }
    if (type === "assistant" && Array.isArray(msg?.content) && touched.length < 600) {
      // Which folders did this session actually work in? (file tools + shell paths)
      for (const c of msg.content as { type?: string; input?: Record<string, unknown> }[]) {
        if (c?.type !== "tool_use" || !c.input) continue;
        for (const k of ["file_path", "notebook_path", "path"]) {
          const v = c.input[k];
          if (typeof v === "string" && v) touched.push(v);
        }
        if (typeof c.input.command === "string") touched.push(...pathsIn(c.input.command).slice(0, 6));
      }
    }
    if (type === "assistant" && msg?.usage) {
      const mid = msg.id ?? String(o.requestId ?? "");
      if (mid && seen.has(mid)) continue; // one API message is written once per content block
      if (mid) seen.add(mid);
      const u = msg.usage;
      const inT = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
      tokensIn += inT;
      tokensCached += u.cache_read_input_tokens ?? 0;
      tokensOut += u.output_tokens ?? 0;
      if (msg.model && msg.model !== "<synthetic>") model = msg.model;
      if (ts) samples.push([ts, inT + (u.output_tokens ?? 0)]);
    }
  }

  const st = await statSig(file);
  if (!updatedAt && st) updatedAt = st.mtimeMs;
  if (!startedAt) startedAt = updatedAt;
  return {
    key: `claude:${id}`,
    id,
    tool: "claude",
    title: customTitle || aiTitle || firstPrompt || "Untitled session",
    cwd,
    project: projectOf(cwd),
    firstPrompt: firstPrompt || undefined,
    aiTitle: aiTitle || undefined,
    customTitle: customTitle || undefined,
    touchedDirs: tallyDirs(touched),
    startedAt,
    updatedAt,
    userTurns,
    tokensIn,
    tokensOut,
    tokensCached,
    model,
    origin,
    samples: compactSamples(samples),
  };
}

/** Bucket usage samples per hour and drop anything older than 8 days. */
function compactSamples(samples: [number, number][]): [number, number][] {
  const cutoff = Date.now() - 8 * 86_400_000;
  const buckets = new Map<number, number>();
  for (const [ts, n] of samples) {
    if (ts < cutoff) continue;
    const h = Math.floor(ts / 3_600_000) * 3_600_000;
    buckets.set(h, (buckets.get(h) ?? 0) + n);
  }
  return [...buckets.entries()].sort((a, b) => a[0] - b[0]);
}

// ─── Codex parser ───

export async function readCodexText(file: string): Promise<string> {
  const buf = await fsp.readFile(file);
  if (file.endsWith(".zst")) {
    const z = zlib as unknown as { zstdDecompressSync?: (b: Buffer) => Buffer };
    if (!z.zstdDecompressSync) throw new Error("this Node version can't read .zst (needs Node 22.15+)");
    return z.zstdDecompressSync(buf).toString("utf8");
  }
  return buf.toString("utf8");
}

async function parseCodex(file: string): Promise<{ summary: CachedEntry["summary"]; rateLimits?: CodexRateLimits; openTurn: boolean; samples: [number, number][] }> {
  const text = await readCodexText(file);
  let id = idFromFile(file);
  let cwd = "";
  let startedAt = 0;
  let updatedAt = 0;
  let firstPrompt = "";
  let userTurns = 0;
  let model: string | undefined;
  let origin: string | undefined;
  let total: Record<string, number> | undefined;
  let rateLimits: CodexRateLimits | undefined;
  let openTurn = false;
  const samples: [number, number][] = [];
  const touched: string[] = [];

  for (const line of text.split("\n")) {
    if (!line) continue;
    let o: { type?: string; timestamp?: string; payload?: Record<string, unknown> };
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const ts = o.timestamp ? Date.parse(o.timestamp) : 0;
    if (ts) {
      if (!startedAt || ts < startedAt) startedAt = ts;
      if (ts > updatedAt) updatedAt = ts;
    }
    const p = o.payload ?? {};
    if (o.type === "session_meta") {
      if (typeof p.id === "string") id = p.id;
      if (typeof p.cwd === "string") cwd = p.cwd;
      if (typeof p.originator === "string") origin = p.originator;
    } else if (o.type === "turn_context") {
      if (typeof p.model === "string") model = p.model;
      if (!cwd && typeof p.cwd === "string") cwd = p.cwd;
    } else if (o.type === "response_item" && p.type === "message" && p.role === "user") {
      const prompt = cleanPrompt(textOf(p.content));
      if (prompt) {
        userTurns++;
        if (!firstPrompt) firstPrompt = prompt;
      }
    } else if (o.type === "response_item" && /call$/.test(String(p.type)) && touched.length < 600) {
      // shell / patch tool calls: arguments (function_call) or input (custom_tool_call)
      const raw = typeof p.arguments === "string" ? p.arguments : typeof p.input === "string" ? p.input : "";
      if (raw) touched.push(...pathsIn(raw).slice(0, 8));
    } else if (o.type === "event_msg") {
      if (p.type === "task_started") openTurn = true;
      if (p.type === "task_complete" || p.type === "turn_aborted") openTurn = false;
      if (p.type === "token_count") {
        const info = p.info as { total_token_usage?: Record<string, number>; last_token_usage?: Record<string, number> } | undefined;
        if (info?.total_token_usage) total = info.total_token_usage;
        const last = info?.last_token_usage;
        if (last && ts) samples.push([ts, (last.input_tokens ?? 0) - (last.cached_input_tokens ?? 0) + (last.output_tokens ?? 0)]);
        const rl = p.rate_limits as Record<string, unknown> | undefined;
        if (rl && ts) {
          rateLimits = {
            ts,
            plan: typeof rl.plan_type === "string" ? rl.plan_type : undefined,
            primary: (rl.primary as CodexRateLimits["primary"]) ?? null,
            secondary: (rl.secondary as CodexRateLimits["secondary"]) ?? null,
            reached: (rl.rate_limit_reached_type as string | null) ?? null,
          };
        }
      }
    }
  }
  const st = await statSig(file);
  if (!updatedAt && st) updatedAt = st.mtimeMs;
  if (!startedAt) startedAt = updatedAt;
  const cached = total?.cached_input_tokens ?? 0;
  return {
    summary: {
      key: `codex:${id}`,
      id,
      tool: "codex",
      title: firstPrompt || "Untitled session",
      cwd,
      project: projectOf(cwd),
      firstPrompt: firstPrompt || undefined,
      touchedDirs: tallyDirs(touched),
      startedAt,
      updatedAt,
      userTurns,
      tokensIn: Math.max(0, (total?.input_tokens ?? 0) - cached),
      tokensOut: total?.output_tokens ?? 0,
      tokensCached: cached,
      model,
      origin,
    },
    rateLimits,
    openTurn,
    samples: compactSamples(samples),
  };
}

async function codexTitles(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    const txt = await fsp.readFile(CODEX_INDEX, "utf8");
    for (const line of txt.split("\n")) {
      if (!line) continue;
      try {
        const o = JSON.parse(line) as { id?: string; thread_name?: string };
        if (o.id && o.thread_name) out.set(o.id, o.thread_name);
      } catch {
        /* skip */
      }
    }
  } catch {
    /* no index */
  }
  return out;
}

// ─── live Claude processes ───

interface LiveClaude {
  status: string;
  updatedAt: number;
  name?: string;
  pid: number;
  /** "interactive" (desktop app / terminal) or a headless run */
  kind?: string;
  entrypoint?: string;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function liveClaude(): Promise<Map<string, LiveClaude>> {
  const out = new Map<string, LiveClaude>();
  let names: string[] = [];
  try {
    names = await fsp.readdir(CLAUDE_LIVE);
  } catch {
    return out;
  }
  for (const n of names) {
    if (!n.endsWith(".json")) continue; // the .key files are never opened
    try {
      const o = JSON.parse(await fsp.readFile(path.join(CLAUDE_LIVE, n), "utf8")) as {
        pid?: number;
        sessionId?: string;
        status?: string;
        updatedAt?: number;
        name?: string;
        kind?: string;
        entrypoint?: string;
        pidDomain?: string;
      };
      // a record copied from another computer: its pid means nothing here (and must never be killed)
      if (o.pidDomain && o.pidDomain.toLowerCase() !== `${process.platform}:${os.hostname().toLowerCase()}`) continue;
      if (!o.sessionId || !o.pid || !pidAlive(o.pid)) continue;
      out.set(o.sessionId, { status: o.status ?? "idle", updatedAt: o.updatedAt ?? 0, name: o.name, pid: o.pid, kind: o.kind, entrypoint: o.entrypoint });
    } catch {
      /* partial write — skip */
    }
  }
  return out;
}

/** Running Claude Code processes on this machine, by session id (for Stop and the live view). */
export async function liveClaudeProcesses(): Promise<Map<string, LiveClaude>> {
  return liveClaude();
}

function claudeStatus(live: LiveClaude | undefined): SessionStatus {
  if (!live) return "ended";
  const s = live.status.toLowerCase();
  if (s === "busy" || s === "running" || s === "working") return "running";
  if (/wait|permission|input|approval|blocked/.test(s)) return "waiting";
  return "idle";
}

// ─── public API ───

/** Path of the session file on THIS machine for a session key (from the parse cache). */
export async function localSessionFiles(): Promise<{ file: string; key: string; tool: SessionTool; updatedAt: number }[]> {
  const cache = await readCache();
  return Object.entries(cache.entries)
    .map(([file, e]) => ({ file, key: e.summary.key, tool: e.summary.tool, updatedAt: e.summary.updatedAt }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function findSessionFile(key: string): Promise<string | undefined> {
  const cache = await readCache();
  for (const [file, e] of Object.entries(cache.entries)) if (e.summary.key === key) return file;
  return undefined;
}

export interface SessionsSnapshot {
  host: string;
  sessions: SessionSummary[];
  subscriptions: SubscriptionMeter[];
  indexing: { done: number; total: number };
  generatedAt: number;
}

/**
 * Parse whatever changed since last time (newest first, time-boxed), then
 * assemble the snapshot from cache. Concurrent callers share one parse pass.
 */
export async function sessionsSnapshot(): Promise<SessionsSnapshot> {
  const host = os.hostname();
  const found = [...(await findClaudeFiles()), ...(await findCodexFiles())].sort((a, b) => b.mtimeMs - a.mtimeMs);
  const cache = await readCache();

  const pending = found.filter((f) => cache.entries[f.file]?.sig !== f.sig);
  if (pending.length > 0) {
    if (!parsing) {
      parsing = (async () => {
        const started = Date.now();
        const updates: Record<string, CachedEntry> = {};
        let lastFlush = started;
        for (const f of pending) {
          if (Date.now() - started > PARSE_BUDGET_MS) break;
          try {
            if (f.tool === "claude") {
              const { samples, ...summary } = await parseClaude(f.file);
              updates[f.file] = { sig: f.sig, summary, samples };
            } else {
              const r = await parseCodex(f.file);
              updates[f.file] = { sig: f.sig, summary: r.summary, rateLimits: r.rateLimits, openTurn: r.openTurn, samples: r.samples };
            }
          } catch {
            /* unreadable file — retried next time */
          }
          // flush progress every couple of seconds so a slow giant file can't lose earlier work
          if (Date.now() - lastFlush > 2_000 && Object.keys(updates).length > 0) {
            await mergeCache(updates, []);
            lastFlush = Date.now();
          }
        }
        const live = new Set(found.map((f) => f.file));
        const removed = Object.keys(cache.entries).filter((k) => !live.has(k));
        if (Object.keys(updates).length > 0 || removed.length > 0) await mergeCache(updates, removed);
      })().finally(() => {
        parsing = null;
      });
    }
    await parsing;
  }

  const fresh = await readCache();
  const titles = await codexTitles();
  const liveMap = await liveClaude();
  const [appTitles, jobs, names] = await Promise.all([desktopAppTitles(), readJobDefs(), readNames()]);
  const now = Date.now();
  const sessions: SessionSummary[] = [];
  let done = 0;

  for (const f of found) {
    const e = fresh.entries[f.file];
    if (!e) {
      const id = idFromFile(f.file);
      sessions.push({
        key: `${f.tool}:${id}`,
        id,
        tool: f.tool,
        title: "Indexing…",
        cwd: "",
        project: f.tool === "claude" ? projectOf(path.basename(path.dirname(f.file))) : "(indexing)",
        host,
        startedAt: f.mtimeMs,
        updatedAt: f.mtimeMs,
        userTurns: 0,
        tokensIn: 0,
        tokensOut: 0,
        tokensCached: 0,
        status: "ended",
        indexing: true,
      });
      continue;
    }
    done++;
    const s = e.summary;
    let status: SessionStatus;
    let liveName: string | undefined;
    if (s.tool === "claude") {
      const live = liveMap.get(s.id);
      status = claudeStatus(live);
      liveName = live?.name;
    } else {
      status = e.openTurn && now - f.mtimeMs < RUNNING_WINDOW_MS ? "running" : "ended";
    }
    const named = resolveNames(s, {
      override: names.sessions[s.key],
      app: s.tool === "claude" ? appTitles.get(s.id) : undefined,
      liveName,
      codexName: s.tool === "codex" ? titles.get(s.id) : undefined,
      job: jobTitle(s.firstPrompt, s.startedAt, jobs),
    });
    const { touchedDirs: _dirs, ...rest } = s;
    void _dirs;
    const lastOpenedAt = s.tool === "claude" ? appTitles.get(s.id)?.lastOpenedAt : undefined;
    const hidden = names.sessions[s.key]?.hidden || undefined;
    sessions.push({ ...rest, ...named, lastOpenedAt, hidden, host, status });
  }

  sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  return {
    host,
    sessions,
    subscriptions: await buildMeters(fresh, new Set(found.map((f) => f.tool))),
    indexing: { done, total: found.length },
    generatedAt: now,
  };
}

/** Pick the best title and project for a session — order documented in lib/projectNames.ts. */
function resolveNames(
  s: CachedEntry["summary"],
  ev: {
    override?: { title?: string; project?: string; by: "user" | "ai" };
    app?: { title?: string; byUser: boolean };
    liveName?: string;
    codexName?: string;
    job?: string;
  },
): Pick<SessionSummary, "title" | "titleSource" | "project" | "projectSource" | "folder"> {
  const o = ev.override;
  const userO = o?.by === "user" ? o : undefined;
  const aiO = o?.by === "ai" ? o : undefined;

  const titles: [string | undefined, TitleSource][] = [
    [userO?.title, "user"],
    [ev.app?.byUser ? ev.app.title : undefined, "user"],
    [s.customTitle, "user"],
    [ev.job, "job"],
    [ev.codexName, "codex"],
    [aiO?.title, "ai"],
    [s.aiTitle ?? ev.app?.title, "auto"],
    [ev.liveName, "app"],
    [s.firstPrompt, "prompt"],
  ];
  const [title, titleSource] = titles.find(([t]) => t && t.trim()) ?? ["Untitled session", "prompt"];

  const folderDir = folderProject(s.cwd);
  const workDir = inferWorkDir(s.touchedDirs);
  let project: string;
  let projectSource: ProjectSource;
  let folder: string | undefined;
  if (userO?.project) [project, projectSource] = [userO.project, "user"];
  else if (folderDir) [project, projectSource, folder] = [prettyProject(folderDir), "folder", folderDir];
  else if (ev.job) [project, projectSource] = [`${productName()} jobs`, "job"];
  else if (workDir) [project, projectSource, folder] = [prettyProject(workDir), "files", workDir];
  else if (aiO?.project) [project, projectSource] = [aiO.project, "ai"];
  else [project, projectSource] = [UNSORTED, "unsorted"];

  return { title: title!.trim(), titleSource, project, projectSource, folder };
}

function sumWindow(cache: CacheFile, tool: SessionTool, ms: number): number {
  const cutoff = Date.now() - ms;
  let n = 0;
  for (const e of Object.values(cache.entries)) {
    if (e.summary.tool !== tool || !e.samples) continue;
    for (const [ts, t] of e.samples) if (ts >= cutoff) n += t;
  }
  return n;
}

/** "claude_max" + "default_claude_max_20x" → "Max 20x"; "claude_pro" → "Pro". */
function claudePlanName(orgType?: string, tier?: string | null): string | undefined {
  const base = orgType?.replace(/^claude_/, "");
  if (!base) return undefined;
  const name = base.charAt(0).toUpperCase() + base.slice(1);
  const mult = tier?.match(/_(\d+x)$/)?.[1];
  return mult ? `${name} ${mult}` : name;
}

/** Account label only — reads ~/.claude.json's oauthAccount block, never credentials. */
async function claudeAccountLabel(): Promise<{ label: string; plan?: string }> {
  try {
    const o = JSON.parse(await fsp.readFile(CLAUDE_JSON, "utf8")) as {
      oauthAccount?: {
        emailAddress?: string;
        displayName?: string;
        organizationName?: string;
        organizationType?: string;
        organizationRateLimitTier?: string | null;
        userRateLimitTier?: string | null;
      };
    };
    const a = o.oauthAccount;
    if (!a) return { label: "Claude" };
    const who = a.displayName || a.emailAddress || "";
    return {
      label: who ? `Claude · ${who}` : "Claude",
      plan: claudePlanName(a.organizationType, a.userRateLimitTier ?? a.organizationRateLimitTier),
    };
  } catch {
    return { label: "Claude" };
  }
}

function windowLabel(minutes: number): string {
  if (minutes >= 10_000) return "weekly";
  if (minutes >= 1_400) return "daily";
  if (minutes >= 60) return `${Math.round(minutes / 60)}h window`;
  return `${minutes}m window`;
}

async function buildMeters(cache: CacheFile, foundTools: Set<SessionTool>): Promise<SubscriptionMeter[]> {
  const meters: SubscriptionMeter[] = [];
  const H5 = 5 * 3_600_000;
  const D7 = 7 * 86_400_000;

  const hasClaude = foundTools.has("claude");
  const acct = await claudeAccountLabel();
  meters.push({
    id: "claude",
    tool: "claude",
    label: acct.label,
    plan: acct.plan,
    tokens5h: sumWindow(cache, "claude", H5),
    tokens7d: sumWindow(cache, "claude", D7),
    status: hasClaude ? "unknown" : "not_set_up",
    note: hasClaude
      ? "Claude Code doesn't write its usage limits to disk — showing tokens used from local sessions."
      : "No Claude Code sessions found on this machine.",
  });

  let rl: CodexRateLimits | undefined;
  for (const e of Object.values(cache.entries)) if (e.rateLimits && (!rl || e.rateLimits.ts > rl.ts)) rl = e.rateLimits;
  const hasCodex = foundTools.has("codex");
  const codexIndexed = Object.values(cache.entries).some((e) => e.summary.tool === "codex");
  const window = rl?.secondary && (rl.secondary.used_percent ?? 0) > (rl.primary?.used_percent ?? 0) ? rl.secondary : rl?.primary;
  const pct = window ? Math.round(window.used_percent) : undefined;
  const resetsAt = window?.resets_at ? window.resets_at * 1000 : undefined;
  const stale = resetsAt !== undefined && resetsAt < Date.now();
  meters.push({
    id: "codex",
    tool: "codex",
    label: "ChatGPT · Codex",
    plan: codexPlanName(rl?.plan),
    usedPercent: stale ? 0 : pct,
    windowLabel: window ? windowLabel(window.window_minutes) : undefined,
    resetsAt: stale ? undefined : resetsAt,
    tokens5h: sumWindow(cache, "codex", H5),
    tokens7d: sumWindow(cache, "codex", D7),
    status: !hasCodex ? "not_set_up" : rl?.reached ? "limited" : pct === undefined ? "unknown" : stale ? "ok" : pct >= 80 ? "near" : "ok",
    note: !hasCodex
      ? "No Codex sessions found on this machine."
      : !codexIndexed
        ? "Codex sessions found — still indexing."
        : stale
        ? "That window has reset since Codex last reported — usage restarts from 0%."
        : "From the usage limits Codex records in its session files.",
    observedAt: rl?.ts,
  });

  meters.push({
    id: "kimi",
    tool: "kimi",
    label: "Kimi",
    tokens5h: 0,
    tokens7d: 0,
    status: "not_set_up",
    note: "Kimi's CLI isn't installed on this machine yet.",
  });
  return meters;
}
