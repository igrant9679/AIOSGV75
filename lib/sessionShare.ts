import crypto from "crypto";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { clusterStatus, isRetired, readConfig, readRetired } from "./cluster";
import { vaultAvailable, vaultInfo } from "./vault";
import { sessionsSnapshot, type SessionSummary, type SubscriptionMeter } from "./sessions";
import { readNames } from "./sessionNaming";
import { looksLikeJunkTitle } from "./projectNames";
import { publishDigests } from "./sessionDigest";
import { mirrorToolMemory } from "./toolMemory";
import { peerFetch } from "./peer";
import type { LiveSession } from "./sessionLive";
import type { SessionEvent } from "./sessionEvents";
import { buildInfo, COMMIT_RE, SELF_UPDATE, type BuildInfo } from "./selfUpdate";
import { acpAgentInfos } from "./acpAgents";
import type { AcpAgentInfo } from "./acpPresets";
import { ACP_AGENT_RE } from "./sessionTools";

/**
 * Session sharing across the machine group — the same channel as cluster
 * heartbeats and health: files in the OneDrive-synced vault, no open ports.
 *
 *   Agentic OS/Cluster/sessions/<host>.json   (one per machine, written by it)
 *
 * Each machine publishes SUMMARIES of its own Claude Code / Codex sessions
 * (title, project, folder, times, tokens, status, launch point, first prompt
 * trimmed to 160 chars) plus its subscription meters — never transcripts.
 * Every machine reads the others' files and merges them into the hub, so
 * Timeline / Projects / Fleet show the whole group.
 *
 * Eventually consistent: a file is at most ~5 minutes old plus OneDrive's
 * sync delay. A machine that goes offline (cluster heartbeat) or stops
 * publishing is shown as stale, and its "running" sessions are not trusted.
 */

export interface SharedSessionsFile {
  v: 1;
  host: string;
  label: string;
  publishedAt: number;
  sessions: SessionSummary[];
  subscriptions: SubscriptionMeter[];
  /** what this machine lets the others do with its sessions (Projects → reply / new session) */
  acceptsReplies?: RemoteReplies;
  /** "lan" when fetched directly from the machine (fresh), else read from the vault */
  via?: "lan" | "vault";
  /** LAN summaries only: what its open sessions are doing, and recent session events */
  live?: LiveSession[];
  events?: SessionEvent[];
  /**
   * Which project-run work it can take (RUN_WORKER). Missing = an older version, which may ignore
   * a run's model choice and turn cap (a Hermes task there could run on a paid model, unleashed),
   * so runs never place tasks on it.
   */
  runWorker?: number;
  /** the build it serves (lib/selfUpdate.ts); missing = built before builds were stamped */
  build?: BuildInfo;
  /** it can be updated from another machine (SELF_UPDATE); missing = it needs update.cmd once */
  selfUpdate?: number;
  /** its "Updates from my other machines" setting */
  updatesAllowed?: boolean;
  /** it can hold a reply until the session is free (QUEUE); missing = an older version, which would send it at once */
  queue?: number;
  /** its switched-on ACP agents, by id and name only (lib/acpAgents.ts) */
  acpAgents?: AcpAgentInfo[];
}

/** Version of "send when free": a reply with whenFree waits on the target instead of running as a new branch. */
export const QUEUE = 1;

/** Version of the run-worker contract this build honours: model, web, turn cap and isolation on a job, and the pickup rules in lib/runs.ts. */
export const RUN_WORKER = 1;

export interface RemoteMachine {
  via: "lan" | "vault";
  host: string;
  label: string;
  publishedAt: number;
  stale: boolean;
  sessions: number;
  subscriptions: SubscriptionMeter[];
  acceptsReplies: RemoteReplies;
  runWorker?: number;
  build?: BuildInfo;
  selfUpdate?: number;
  updatesAllowed?: boolean;
  queue?: number;
  acpAgents?: AcpAgentInfo[];
}

/** What this machine can do for the others beyond its version: hold messages, and its ACP agents (names only). */
const capabilityFields = async () => ({ queue: QUEUE, acpAgents: await acpAgentInfos().catch(() => [] as AcpAgentInfo[]) });

const PUBLISH_EVERY_MS = 5 * 60_000;

/** What this machine says about its own version (Fleet → Versions). */
const versionFields = (settings: ShareSettings) => {
  const b = buildInfo();
  return {
    build: b ? { commit: b.commit, short: b.short, subject: b.subject, at: b.at, branch: b.branch, dirty: b.dirty, builtAt: b.builtAt } : undefined,
    selfUpdate: SELF_UPDATE,
    updatesAllowed: settings.remoteUpdates,
  };
};
const MAX_SESSIONS = 500;

function shareDir(): string {
  return path.join(vaultInfo().base, "Cluster", "sessions");
}

const fileFor = (host: string) => path.join(shareDir(), `${host.replace(/[^A-Za-z0-9_-]+/g, "_")}.json`);

async function sharingOn(): Promise<boolean> {
  const cfg = await readConfig().catch(() => null);
  return Boolean(cfg?.enabled) && (await vaultAvailable());
}

/** Summary fields only — what another machine needs to list and group a session. */
function slim(s: SessionSummary): SessionSummary {
  return {
    key: s.key,
    id: s.id,
    tool: s.tool,
    title: s.title,
    titleSource: s.titleSource,
    cwd: s.cwd,
    project: s.project,
    projectSource: s.projectSource,
    folder: s.folder,
    host: s.host,
    startedAt: s.startedAt,
    updatedAt: s.updatedAt,
    lastOpenedAt: s.lastOpenedAt,
    userTurns: s.userTurns,
    tokensIn: s.tokensIn,
    tokensOut: s.tokensOut,
    tokensCached: s.tokensCached,
    model: s.model,
    origin: s.origin,
    firstPrompt: s.firstPrompt?.slice(0, 160),
    status: s.status,
  };
}

// ─── per-machine sharing settings (data/share-settings.json) ───

export interface ShareSettings {
  /** conversation digests as vault notes (Agentic OS/Sessions/<machine>/) */
  conversations: boolean;
  /** read-only mirror of Claude/Codex memory files (Agentic OS/Tool Memory/<machine>/) */
  toolMemory: boolean;
  /**
   * Replies and new sessions requested by your OTHER machines (Projects page),
   * delivered through the vault. "off" by default: anything that can write to
   * the vault could otherwise start AI runs here.
   */
  remoteReplies: RemoteReplies;
  /**
   * Updates asked for by your other machines (Fleet → Versions). On by default: an update only
   * installs what is already on this install's own GitHub branch, and waits until nothing runs.
   */
  remoteUpdates: boolean;
}

export type RemoteReplies = "off" | "answer" | "edit";

const SETTINGS_FILE = path.join(process.cwd(), "data", "share-settings.json");
// remoteReplies is ON by default ("answer": read and answer, nothing that needs
// approval), so a machine that joins the group can be worked from the others
// straight away. A machine where the setting was ever saved keeps what it saved.
const DEFAULT_SETTINGS: ShareSettings = { conversations: true, toolMemory: true, remoteReplies: "answer", remoteUpdates: true };

export async function readShareSettings(): Promise<ShareSettings> {
  try {
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(await fsp.readFile(SETTINGS_FILE, "utf8")) as Partial<ShareSettings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function writeShareSettings(patch: Partial<ShareSettings>): Promise<ShareSettings> {
  const next = { ...(await readShareSettings()), ...patch };
  await fsp.mkdir(path.dirname(SETTINGS_FILE), { recursive: true });
  await fsp.writeFile(SETTINGS_FILE, JSON.stringify(next, null, 2), "utf8");
  return next;
}

// ─── the sharing pass ───

export interface ShareResult {
  on: boolean;
  summaries: "written" | "unchanged" | "skipped";
  digests: number;
  memoryFiles: number;
  at: number;
}

const STATE_FILE = path.join(process.cwd(), "data", "share-state.json");

export async function readShareState(): Promise<ShareResult | null> {
  try {
    return JSON.parse(await fsp.readFile(STATE_FILE, "utf8")) as ShareResult;
  } catch {
    return null;
  }
}

let sharing: Promise<ShareResult> | null = null;

/**
 * One sharing pass for THIS machine: session summaries (skipped when nothing
 * changed, to keep OneDrive quiet), then conversation digests and tool memory
 * if enabled. Waits until the local session index is complete.
 */
export function shareNow(): Promise<ShareResult> {
  if (sharing) return sharing;
  sharing = (async (): Promise<ShareResult> => {
    const at = Date.now();
    if (!(await sharingOn())) return { on: false, summaries: "skipped", digests: 0, memoryFiles: 0, at };
    const snap = await sessionsSnapshot();
    if (snap.indexing.done < snap.indexing.total) return { on: true, summaries: "skipped", digests: 0, memoryFiles: 0, at };
    const [cfg, settings] = await Promise.all([readConfig(), readShareSettings()]);
    const label = cfg.label || os.hostname();
    const local = snap.sessions.filter((s) => !s.indexing);

    const file = fileFor(os.hostname());
    const body = { sessions: local.slice(0, MAX_SESSIONS).map(slim), subscriptions: snap.subscriptions, acceptsReplies: settings.remoteReplies, runWorker: RUN_WORKER, ...versionFields(settings), ...(await capabilityFields()) };
    const hash = crypto.createHash("sha1").update(JSON.stringify(body)).digest("hex");
    const prev = await fsp.readFile(file, "utf8").then((t) => JSON.parse(t) as SharedSessionsFile & { hash?: string }).catch(() => null);
    let summaries: ShareResult["summaries"] = "unchanged";
    // rewrite when changed, and at least hourly so other machines see a recent publish time
    if (prev?.hash !== hash || prev.label !== label || Date.now() - prev.publishedAt > 60 * 60_000) {
      const out: SharedSessionsFile & { hash: string } = { v: 1, host: os.hostname(), label, publishedAt: Date.now(), hash, ...body };
      await fsp.mkdir(shareDir(), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await fsp.writeFile(tmp, JSON.stringify(out), "utf8");
      await fsp.rename(tmp, file);
      summaries = "written";
    }

    const digests = settings.conversations ? await publishDigests(local, label).catch(() => 0) : 0;
    const memoryFiles = settings.toolMemory ? await mirrorToolMemory(label).catch(() => 0) : 0;
    const result: ShareResult = { on: true, summaries, digests, memoryFiles, at: Date.now() };
    await fsp.writeFile(STATE_FILE, JSON.stringify(result), "utf8").catch(() => {});
    return result;
  })()
    .catch((): ShareResult => ({ on: true, summaries: "skipped", digests: 0, memoryFiles: 0, at: Date.now() }))
    .finally(() => {
      sharing = null;
    });
  return sharing;
}

/** Background tick: share every 5 minutes. */
export async function maybeShare(): Promise<void> {
  const last = await readShareState();
  if (last && last.summaries !== "skipped" && Date.now() - last.at < PUBLISH_EVERY_MS) return;
  if (last && last.summaries === "skipped" && Date.now() - last.at < 60_000) return; // index still filling: retry each minute
  await shareNow();
}

let summaryCache: { at: number; data: SharedSessionsFile } | null = null;

/**
 * What this machine shares, right now - served to LAN peers (/peer/summary),
 * so machines on the same network see each other within seconds instead of
 * waiting for the 5-minute vault file + OneDrive. Includes live session state
 * and recent session events. Cached 10 s.
 */
export async function localSummary(): Promise<SharedSessionsFile> {
  if (summaryCache && Date.now() - summaryCache.at < 10_000) return summaryCache.data;
  const [snap, cfg, settings] = await Promise.all([sessionsSnapshot(), readConfig(), readShareSettings()]);
  const { liveSnapshot } = await import("./sessionLive");
  const { ownEvents } = await import("./sessionEvents");
  const data: SharedSessionsFile = {
    v: 1,
    host: os.hostname(),
    label: cfg.label || os.hostname(),
    publishedAt: Date.now(),
    sessions: snap.sessions.filter((s) => !s.indexing).slice(0, MAX_SESSIONS).map(slim),
    subscriptions: snap.subscriptions,
    acceptsReplies: settings.remoteReplies,
    runWorker: RUN_WORKER,
    ...versionFields(settings),
    ...(await capabilityFields()),
    via: "lan",
    live: await liveSnapshot().catch(() => []),
    events: await ownEvents(80).catch(() => []),
  };
  summaryCache = { at: Date.now(), data };
  return data;
}

const lanCache = new Map<string, { at: number; f: SharedSessionsFile }>();

/** A LAN peer's live summary (cached 15 s; a recent copy is reused for 2 min if it drops off). */
async function lanSummary(host: string): Promise<SharedSessionsFile | null> {
  const c = lanCache.get(host);
  if (c && Date.now() - c.at < 15_000) return c.f;
  try {
    const f = await peerFetch<SharedSessionsFile>(host, "/peer/summary", { timeoutMs: 4_000 });
    if (!f?.host || !Array.isArray(f.sessions)) return null;
    f.via = "lan";
    lanCache.set(host, { at: Date.now(), f });
    return f;
  } catch {
    return c && Date.now() - c.at < 2 * 60_000 ? c.f : null;
  }
}

/** Other machines' published files (never this machine's own) - over the LAN when possible, else from the vault. */
export async function readRemoteSessions(): Promise<SharedSessionsFile[]> {
  if (!(await sharingOn())) return [];
  const me = os.hostname().toLowerCase();
  const retired = await readRetired().catch(() => ({}));
  const st = await clusterStatus().catch(() => null);
  const lanHosts = (st?.nodes ?? []).filter((n) => !n.self && !isRetired(retired, n.host)).map((n) => n.host);
  const lanPromise = Promise.all(lanHosts.map((h) => lanSummary(h)));
  let names: string[] = [];
  try {
    names = await fsp.readdir(shareDir());
  } catch {
    names = [];
  }
  const out: SharedSessionsFile[] = [];
  for (const n of names) {
    if (!n.endsWith(".json")) continue;
    try {
      const f = JSON.parse(await fsp.readFile(path.join(shareDir(), n), "utf8")) as SharedSessionsFile;
      if (!f.host || f.host.toLowerCase() === me || !Array.isArray(f.sessions) || isRetired(retired, f.host)) continue;
      out.push(f);
    } catch {
      /* mid-sync partial file — next refresh */
    }
  }
  // a LAN answer is fresher than the vault file
  for (const f of await lanPromise) {
    if (!f || f.host.toLowerCase() === me) continue;
    const i = out.findIndex((x) => x.host.toLowerCase() === f.host.toLowerCase());
    if (i >= 0) out[i] = f;
    else out.push(f);
  }
  return out;
}

export interface MergedSessions {
  sessions: SessionSummary[];
  remote: RemoteMachine[];
}

/**
 * This machine's sessions plus every other machine's, de-duplicated by key
 * (a session copied between machines keeps the newer copy), with this
 * machine's renames (data/session-names.json) applied on top.
 */
export async function mergeRemoteSessions(local: SessionSummary[]): Promise<MergedSessions> {
  const [files, names, cluster] = await Promise.all([readRemoteSessions(), readNames(), clusterStatus().catch(() => null)]);
  const online = new Map((cluster?.nodes ?? []).map((n) => [n.host.toLowerCase(), n.online]));
  const byKey = new Map(local.map((s) => [s.key, s]));
  const remote: RemoteMachine[] = [];
  const now = Date.now();
  for (const f of files) {
    // offline per the 30s cluster heartbeat, or not publishing for 2h (old version / sharing off)
    const stale = f.via === "lan" ? false : online.get(f.host.toLowerCase()) === false || now - f.publishedAt > 2 * 60 * 60_000;
    remote.push({
      via: f.via === "lan" ? "lan" : "vault",
      host: f.host,
      label: f.label || f.host,
      publishedAt: f.publishedAt,
      stale,
      sessions: f.sessions.length,
      subscriptions: f.subscriptions ?? [],
      acceptsReplies: f.acceptsReplies ?? "off",
      runWorker: typeof f.runWorker === "number" ? f.runWorker : undefined,
      build: f.build && typeof f.build.commit === "string" && COMMIT_RE.test(f.build.commit) ? f.build : undefined,
      selfUpdate: typeof f.selfUpdate === "number" ? f.selfUpdate : undefined,
      updatesAllowed: typeof f.updatesAllowed === "boolean" ? f.updatesAllowed : undefined,
      queue: typeof f.queue === "number" ? f.queue : undefined,
      acpAgents: Array.isArray(f.acpAgents)
        ? f.acpAgents.filter((a) => a && typeof a.id === "string" && ACP_AGENT_RE.test(a.id) && typeof a.label === "string").map((a) => ({ id: a.id, label: a.label.slice(0, 40) })).slice(0, 20)
        : undefined,
    });
    for (const raw of f.sessions) {
      const s: SessionSummary = { ...raw, host: f.host };
      // a stale machine's "running" claims can't be trusted
      if (stale && s.status !== "ended") s.status = "ended";
      const o = names.sessions[s.key];
      if (o?.hidden) s.hidden = true;
      if (o?.by === "user") {
        if (o.title) [s.title, s.titleSource] = [o.title, "user"];
        if (o.project) [s.project, s.projectSource] = [o.project, "user"];
      } else if (o?.by === "ai") {
        // AI grouping run on this machine only fills what the owner machine couldn't
        if (o.project && (s.projectSource === "unsorted" || !s.projectSource)) [s.project, s.projectSource] = [o.project, "ai"];
        if (o.title && s.titleSource !== "user" && looksLikeJunkTitle(s.title)) [s.title, s.titleSource] = [o.title, "ai"];
      }
      const have = byKey.get(s.key);
      if (!have || s.updatedAt > have.updatedAt) byKey.set(s.key, s);
    }
  }
  const sessions = [...byKey.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  return { sessions, remote };
}

/** Status for the Health panel. */
export async function sharingStatus(): Promise<{ on: boolean; publishedAt?: number; remote: { host: string; label: string; publishedAt: number }[] }> {
  if (!(await sharingOn())) return { on: false, remote: [] };
  const st = await fsp.stat(fileFor(os.hostname())).catch(() => null);
  const files = await readRemoteSessions();
  return {
    on: true,
    publishedAt: st?.mtimeMs,
    remote: files.map((f) => ({ host: f.host, label: f.label || f.host, publishedAt: f.publishedAt })),
  };
}
