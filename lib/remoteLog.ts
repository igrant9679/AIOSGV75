import fsp from "fs/promises";
import path from "path";
import os from "os";
import { vaultAvailable, vaultInfo } from "./vault";

/**
 * The log of every remote action (Fleet → Remote actions).
 *
 * Every request one machine makes of another is recorded on BOTH ends: "out" where it was sent,
 * "in" where it arrived, with what it was, where it came from, how it travelled and whether it
 * was carried out or refused. Each machine shares its newest entries in the vault
 * (Agentic OS/Cluster/actions/<host>.json), so Fleet shows them all together.
 *
 * Why both ends: requests travel through a vault folder that anything syncing the vault could
 * write to. An "in" entry naming a machine whose own log has no matching "out" is flagged
 * (crossCheck) — that is a request that machine never sent.
 *
 * Append-only JSON lines (data/remote-actions.jsonl), so the scheduler's module instance and the
 * route handlers can both write without a read-modify-write race (AGENTS.md rule 1).
 */

export type { RemoteKind, RemoteAction, SharedLog, CheckedAction } from "./remoteCheck";
export { crossCheck } from "./remoteCheck";
import type { RemoteAction, SharedLog } from "./remoteCheck";

const LOG = path.join(process.cwd(), "data", "remote-actions.jsonl");
const KEEP = 1_000;
const SHARE = 300;
const PUBLISH_EVERY_MS = 10 * 60_000;

const clip = (s: string | undefined, n: number) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** Record one action. Never throws: a log that can't be written must not stop the action itself. */
export async function logRemote(a: Omit<RemoteAction, "at"> & { at?: number }): Promise<void> {
  try {
    const entry: RemoteAction = { ...a, at: a.at ?? Date.now(), what: clip(a.what, 160), reason: a.reason ? clip(a.reason, 200) : undefined };
    await fsp.mkdir(path.dirname(LOG), { recursive: true });
    await fsp.appendFile(LOG, `${JSON.stringify(entry)}\n`, "utf8");
  } catch {
    /* best effort */
  }
}

/** Newest first. Trims the file when it has grown well past the cap. */
export async function readRemoteLog(limit = KEEP): Promise<RemoteAction[]> {
  let raw = "";
  try {
    raw = await fsp.readFile(LOG, "utf8");
  } catch {
    return [];
  }
  const lines = raw.split("\n").filter(Boolean);
  const out: RemoteAction[] = [];
  for (const l of lines) {
    try {
      out.push(JSON.parse(l) as RemoteAction);
    } catch {
      /* a torn line */
    }
  }
  if (lines.length > KEEP * 2) {
    const keep = lines.slice(-KEEP).join("\n") + "\n";
    const tmp = `${LOG}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, keep, "utf8").then(() => fsp.rename(tmp, LOG)).catch(() => {});
  }
  return out.reverse().slice(0, limit);
}

/** A one-line description of a job for the log. */
export function describeJob(j: { mode: string; title?: string; project?: string; cwd?: string; setupAction?: string; setupTarget?: string; check?: string; prompt?: string }): string {
  if (j.mode === "setup") return `${j.setupAction ?? "change"} ${j.setupTarget ?? ""}`.trim();
  if (j.mode === "check") return `check ${j.check ?? ""}${j.project ? ` in ${j.project}` : ""}`;
  if (j.mode === "update") return "update Mission Control";
  const where = j.title || j.project || (j.cwd && j.cwd !== "~" ? path.basename(j.cwd) : j.cwd === "~" ? "home folder" : "");
  const said = j.mode === "reply" || j.mode === "new" ? clip(j.prompt, 70) : "";
  return [where, said && `"${said}"`].filter(Boolean).join(" — ");
}

// ─── sharing ───

const shareDir = () => path.join(vaultInfo().base, "Cluster", "actions");
const fileFor = (host: string) => path.join(shareDir(), `${host.replace(/[^A-Za-z0-9_-]+/g, "_")}.json`);
let lastPublish = 0;

/** This machine's shareable log, with each job's final state from the job store. */
export async function localLog(label: string): Promise<SharedLog> {
  const all = await readRemoteLog(KEEP);
  const { listJobs } = await import("./sessionActions");
  const jobs = new Map((await listJobs()).map((j) => [j.id, j]));
  const entries = all.slice(0, SHARE).map((e) => {
    const j = jobs.get(e.id);
    return j && (e.outcome === "accepted" || e.outcome === "sent") ? { ...e, status: j.status } : e;
  });
  const coversFrom = all.length > SHARE ? entries[entries.length - 1].at : await logStart();
  return { v: 1, host: os.hostname(), label, publishedAt: Date.now(), coversFrom, entries };
}

/** When this machine started keeping the log (the file's creation; now, if there is none yet). */
async function logStart(): Promise<number> {
  try {
    const st = await fsp.stat(LOG);
    return Math.min(st.birthtimeMs || st.mtimeMs, st.mtimeMs);
  } catch {
    return Date.now();
  }
}

/**
 * Publish to the vault when something new was logged (at most every 10 minutes), and every 6
 * hours regardless, so other machines can tell an empty log from a silent one. "New" is the log
 * file's own time, not a flag: route handlers write the log, the scheduler's instance publishes it.
 */
export async function maybePublishLog(label: string, force = false): Promise<void> {
  const changed = await fsp.stat(LOG).then((s) => s.mtimeMs > lastPublish, () => false);
  const due = (changed && Date.now() - lastPublish >= PUBLISH_EVERY_MS) || Date.now() - lastPublish >= 6 * 3_600_000;
  if (!force && !due) return;
  if (!(await vaultAvailable())) return;
  lastPublish = Date.now();
  const data = await localLog(label);
  await fsp.mkdir(shareDir(), { recursive: true });
  const tmp = `${fileFor(data.host)}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(data), "utf8");
  for (let i = 0; i < 5; i++) {
    try {
      await fsp.rename(tmp, fileFor(data.host));
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  await fsp.rm(tmp, { force: true }).catch(() => {});
}

/** Every other machine's shared log (never this machine's own: that is read live). */
export async function remoteLogs(): Promise<SharedLog[]> {
  if (!(await vaultAvailable())) return [];
  const me = os.hostname().toLowerCase();
  const names = await fsp.readdir(shareDir()).catch(() => [] as string[]);
  const out: SharedLog[] = [];
  for (const n of names) {
    if (!n.endsWith(".json")) continue;
    try {
      const f = JSON.parse(await fsp.readFile(path.join(shareDir(), n), "utf8")) as SharedLog;
      if (f?.v === 1 && f.host && f.host.toLowerCase() !== me && Array.isArray(f.entries)) out.push(f);
    } catch {
      /* mid-sync */
    }
  }
  return out;
}

