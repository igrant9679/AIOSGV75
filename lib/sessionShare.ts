import crypto from "crypto";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { clusterStatus, readConfig } from "./cluster";
import { vaultAvailable, vaultInfo } from "./vault";
import { sessionsSnapshot, type SessionSummary, type SubscriptionMeter } from "./sessions";
import { readNames } from "./sessionNaming";
import { looksLikeJunkTitle } from "./projectNames";
import { publishDigests } from "./sessionDigest";
import { mirrorToolMemory } from "./toolMemory";

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
}

export interface RemoteMachine {
  host: string;
  label: string;
  publishedAt: number;
  stale: boolean;
  sessions: number;
  subscriptions: SubscriptionMeter[];
}

const PUBLISH_EVERY_MS = 5 * 60_000;
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
}

const SETTINGS_FILE = path.join(process.cwd(), "data", "share-settings.json");
const DEFAULT_SETTINGS: ShareSettings = { conversations: true, toolMemory: true };

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
    const body = { sessions: local.slice(0, MAX_SESSIONS).map(slim), subscriptions: snap.subscriptions };
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

/** Other machines' published files (never this machine's own). */
export async function readRemoteSessions(): Promise<SharedSessionsFile[]> {
  if (!(await sharingOn())) return [];
  const me = os.hostname().toLowerCase();
  let names: string[] = [];
  try {
    names = await fsp.readdir(shareDir());
  } catch {
    return [];
  }
  const out: SharedSessionsFile[] = [];
  for (const n of names) {
    if (!n.endsWith(".json")) continue;
    try {
      const f = JSON.parse(await fsp.readFile(path.join(shareDir(), n), "utf8")) as SharedSessionsFile;
      if (!f.host || f.host.toLowerCase() === me || !Array.isArray(f.sessions)) continue;
      out.push(f);
    } catch {
      /* mid-sync partial file — next refresh */
    }
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
    const stale = online.get(f.host.toLowerCase()) === false || now - f.publishedAt > 2 * 60 * 60_000;
    remote.push({ host: f.host, label: f.label || f.host, publishedAt: f.publishedAt, stale, sessions: f.sessions.length, subscriptions: f.subscriptions ?? [] });
    for (const raw of f.sessions) {
      const s: SessionSummary = { ...raw, host: f.host };
      // a stale machine's "running" claims can't be trusted
      if (stale && s.status !== "ended") s.status = "ended";
      const o = names.sessions[s.key];
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
