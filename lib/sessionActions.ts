import { spawn, spawnSync } from "child_process";
import { productName } from "./netSettings";
import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { cleanEnv } from "./runners";
import { liveClaudeProcesses, sessionsSnapshot, type SessionSummary, type SessionTool } from "./sessions";
import { mergeRemoteSessions, readShareSettings, type RemoteReplies } from "./sessionShare";
import { readConfig } from "./cluster";
import { vaultAvailable, vaultInfo } from "./vault";
import { readThread, type Thread } from "./sessionThread";
import { PeerUnavailable, peerFetch } from "./peer";
import { exportSession, importSession, type HandoffPackage } from "./handoff";
import { setHidden } from "./sessionNaming";

/**
 * Acting on sessions - from the Projects page, the live view and the
 * run-somewhere box:
 *
 *  - reply   continue an existing Claude Code / Codex session (claude -p
 *            --resume / codex exec resume) in its own folder. A Claude session
 *            that is open right now is forked (--fork-session) instead.
 *  - new     start a new session in a project's folder (or the home folder).
 *  - thread  fetch the full thread of a session on another machine.
 *  - stop    stop a running session or Mission Control run.
 *  - import  hand a session from this machine to another one (push).
 *  - export  bring another machine's session to this one (pull).
 *  - open    terminal / folder / VS Code, on this machine only.
 *
 * Another machine is reached over the LAN when it can be (lib/peer.ts,
 * instant), else through the vault (1-2 minutes, OneDrive):
 *
 *   Agentic OS/Cluster/requests/<target-host>/<job-id>.json           request
 *   Agentic OS/Cluster/requests/<target-host>/results/<job-id>.json   result
 *   Agentic OS/Cluster/handoff/<job-id>.jsonl                         a session being moved
 *
 * Either way the target only acts when ITS "Replies from my other machines"
 * setting allows it (off by default), only on sessions / folders it really
 * has, and never with more access than that setting grants.
 *
 * data/session-jobs.json is the source of truth (re-read on every call).
 */

export type JobMode = "reply" | "new" | "thread" | "stop" | "import" | "export";
export type JobAccess = "answer" | "edit";
export type JobStatus = "queued" | "sent" | "running" | "done" | "error" | "expired";

export interface SessionJob {
  id: string;
  mode: JobMode;
  tool: SessionTool;
  /** session replied to / stopped / moved / whose thread was asked for */
  key?: string;
  sessionId?: string;
  /** stop: a Mission Control run to stop */
  stopJobId?: string;
  /** machine that runs it */
  host: string;
  hostLabel: string;
  cwd: string;
  project?: string;
  title?: string;
  prompt: string;
  access: JobAccess;
  fork: boolean;
  status: JobStatus;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  reply?: string;
  error?: string;
  /** the session the result landed in (differs from `key` when forked / new / moved) */
  resultKey?: string;
  costUsd?: number;
  /** how a cross-machine job travels */
  via?: "lan" | "vault";
  /** process of a running local job (for Stop) */
  pid?: number;
  /** import / export: where the session goes on the receiving machine, and what then */
  handoff?: { fromHost: string; fromLabel: string; oldCwd: string; targetCwd: string; openTerminal: boolean; hideSource: boolean };
  /** run-somewhere: why this machine was picked */
  dispatch?: string;
  /** set on the TARGET machine for a job another machine asked for */
  requestedBy?: string;
  requestedByLabel?: string;
}

const JOBS_FILE = path.join(process.cwd(), "data", "session-jobs.json");
const THREADS_DIR = path.join(process.cwd(), "data", "threads");
const MAX_KEPT = 200;
const MAX_RUNNING = 2;
const RUN_TIMEOUT_MS = 20 * 60_000;
const REMOTE_EXPIRE_MS = 30 * 60_000;
const MAX_PROMPT = 20_000;

const me = () => os.hostname();
const ACTIVE: JobStatus[] = ["queued", "sent", "running"];
const isActive = (j: SessionJob) => ACTIVE.includes(j.status);

// ─── job store ───

export async function listJobs(): Promise<SessionJob[]> {
  try {
    const j = JSON.parse(await fsp.readFile(JOBS_FILE, "utf8")) as SessionJob[];
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}

let chain: Promise<unknown> = Promise.resolve();
/** Serialized read-modify-write (per process; tmp+rename keeps the file whole across processes). */
function mutate<T>(fn: (jobs: SessionJob[]) => T): Promise<T> {
  const run = chain.then(async () => {
    const jobs = await listJobs();
    const out = fn(jobs);
    await fsp.mkdir(path.dirname(JOBS_FILE), { recursive: true });
    const tmp = `${JOBS_FILE}.${process.pid}.${Date.now()}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(jobs.slice(0, MAX_KEPT), null, 2), "utf8");
    await fsp.rename(tmp, JOBS_FILE);
    return out;
  });
  chain = run.catch(() => {});
  return run;
}

async function patchJob(id: string, patch: Partial<SessionJob>): Promise<SessionJob | undefined> {
  const job = await mutate((jobs) => {
    const j = jobs.find((x) => x.id === id);
    if (j) Object.assign(j, patch);
    return j ? { ...j } : undefined;
  });
  if (job?.requestedBy && job.via === "vault") await writeVaultResult(job).catch(() => {});
  return job;
}

export async function dismissJob(id: string): Promise<void> {
  await mutate((jobs) => {
    const i = jobs.findIndex((j) => j.id === id && !isActive(j));
    if (i >= 0) jobs.splice(i, 1);
  });
  await fsp.rm(path.join(THREADS_DIR, `${id}.json`), { force: true }).catch(() => {});
}

let seq = 0;
const newId = () => `sj-${Date.now().toString(36)}-${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const ID_RE = /^sj-[\w-]+$/;

// ─── the vault channel ───

const clusterDir = () => path.join(vaultInfo().base, "Cluster");
const requestsDir = (host: string) => path.join(clusterDir(), "requests", host.replace(/[^A-Za-z0-9_-]+/g, "_"));
const handoffFile = (id: string) => path.join(clusterDir(), "handoff", `${id}.jsonl`);

async function groupOn(): Promise<boolean> {
  const cfg = await readConfig().catch(() => null);
  return Boolean(cfg?.enabled) && (await vaultAvailable());
}

async function writeJson(file: string, data: unknown): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(data), "utf8");
  await fsp.rename(tmp, file);
}

async function readThreadFile(id: string): Promise<Thread | undefined> {
  try {
    return JSON.parse(await fsp.readFile(path.join(THREADS_DIR, `${id}.json`), "utf8")) as Thread;
  } catch {
    return undefined;
  }
}

const resultOf = (job: SessionJob) => ({
  id: job.id,
  status: job.status,
  startedAt: job.startedAt,
  finishedAt: job.finishedAt,
  reply: job.reply,
  error: job.error,
  resultKey: job.resultKey,
  costUsd: job.costUsd,
});

async function writeVaultResult(job: SessionJob): Promise<void> {
  if (!job.requestedBy) return;
  const res: ReturnType<typeof resultOf> & { thread?: Thread } = resultOf(job);
  if (job.mode === "thread" && job.status === "done") res.thread = await readThreadFile(job.id);
  await writeJson(path.join(requestsDir(me()), "results", `${job.id}.json`), res);
}

/** /peer/job - a job's progress for the machine that asked for it over the LAN. */
export async function jobForPeer(id: string): Promise<ReturnType<typeof resultOf> & { thread?: Thread }> {
  if (!ID_RE.test(id)) throw new Error("bad id");
  const j = (await listJobs()).find((x) => x.id === id);
  if (!j) throw Object.assign(new Error("unknown job"), { status: 404 });
  return { ...resultOf(j), thread: j.mode === "thread" && j.status === "done" ? await readThreadFile(j.id) : undefined };
}

/** /peer/thread - full thread of a session on this machine. */
export async function localThread(key: string): Promise<Thread | null> {
  const snap = await sessionsSnapshot();
  const s = snap.sessions.find((x) => x.key === key);
  return s ? readThread(s, 1500) : null;
}

// ─── starting jobs ───

export interface StartInput {
  mode: JobMode;
  /** reply / thread / stop / import / export: the session */
  key?: string;
  /** new / import / export: the folder on the machine that runs it ("~" = home folder) */
  folder?: string;
  /** new / import: the machine to run on / move to */
  host?: string;
  tool?: SessionTool;
  project?: string;
  prompt?: string;
  access?: JobAccess;
  fork?: boolean;
  /** stop: a Mission Control run */
  jobId?: string;
  openTerminal?: boolean;
  hideSource?: boolean;
  dispatch?: string;
}

export async function startJob(input: StartInput): Promise<SessionJob> {
  const snap = await sessionsSnapshot();
  const { sessions, remote } = await mergeRemoteSessions(snap.sessions);
  const cfg = await readConfig().catch(() => null);
  const myLabel = cfg?.label || me();
  const labelOf = (host: string) => (host === me() ? myLabel : (remote.find((r) => r.host === host)?.label ?? host));
  const prompt = (input.prompt ?? "").trim();
  const access: JobAccess = input.access === "edit" ? "edit" : "answer";
  if ((input.mode === "reply" || input.mode === "new") && !prompt) throw new Error("Write a message first.");
  if (prompt.length > MAX_PROMPT) throw new Error(`That message is too long (max ${MAX_PROMPT.toLocaleString()} characters).`);
  const base = { id: newId(), prompt, access, fork: false, status: "queued" as JobStatus, createdAt: Date.now(), dispatch: input.dispatch };

  let job: SessionJob;
  let content: HandoffPackage | undefined;
  const s = input.key ? sessions.find((x) => x.key === input.key) : undefined;

  switch (input.mode) {
    case "reply":
    case "thread": {
      if (!s) throw new Error("That session isn't in the list any more.");
      const local = s.host === me();
      if (input.mode === "thread" && local) throw new Error("This session is on this machine - read it directly.");
      job = {
        ...base,
        mode: input.mode,
        tool: s.tool,
        key: s.key,
        sessionId: s.id,
        host: s.host,
        hostLabel: labelOf(s.host),
        cwd: s.cwd,
        project: s.project,
        title: s.title,
        // Codex can't fork; Claude forks when asked or when the session is open right now
        fork: s.tool === "claude" && input.mode === "reply" && (Boolean(input.fork) || (local && s.status !== "ended")),
      };
      break;
    }
    case "new": {
      const host = input.host || me();
      const tool: SessionTool = input.tool === "codex" ? "codex" : "claude";
      const folder = input.folder ?? "";
      // only folders that sessions on that machine actually used (or its home folder) - never an arbitrary path
      const known = folder === "~" || sessions.some((x) => x.host === host && (x.folder === folder || x.cwd === folder));
      if (!folder || !known) throw new Error("Pick a project that has a folder first.");
      job = { ...base, mode: "new", tool, host, hostLabel: labelOf(host), cwd: folder, project: input.project };
      break;
    }
    case "stop": {
      if (input.jobId) {
        const j = (await listJobs()).find((x) => x.id === input.jobId);
        if (!j) throw new Error("That run isn't in the list.");
        job = { ...base, mode: "stop", tool: j.tool, stopJobId: j.id, key: j.key, host: j.host, hostLabel: j.hostLabel, cwd: j.cwd, title: j.title };
        if (j.host !== me()) job.stopJobId = j.id; // the target knows the run by the same id
      } else {
        if (!s) throw new Error("That session isn't in the list any more.");
        job = { ...base, mode: "stop", tool: s.tool, key: s.key, sessionId: s.id, host: s.host, hostLabel: labelOf(s.host), cwd: s.cwd, title: s.title };
      }
      break;
    }
    case "import": {
      // push one of THIS machine's sessions to another machine
      if (!s || s.host !== me()) throw new Error("Pick a session on this machine to move.");
      const host = input.host ?? "";
      if (!host || host === me()) throw new Error("Pick the machine to move it to.");
      content = await exportSession(s.key);
      job = {
        ...base,
        mode: "import",
        tool: s.tool,
        key: s.key,
        sessionId: s.id,
        host,
        hostLabel: labelOf(host),
        cwd: input.folder || "~",
        project: s.project,
        title: s.title,
        handoff: { fromHost: me(), fromLabel: myLabel, oldCwd: s.cwd, targetCwd: input.folder || "~", openTerminal: Boolean(input.openTerminal), hideSource: input.hideSource !== false },
      };
      break;
    }
    case "export": {
      // pull another machine's session to THIS machine
      if (!s || s.host === me()) throw new Error("Pick a session on another machine to bring here.");
      if (s.tool !== "claude") throw new Error("Only Claude Code sessions can be moved between machines.");
      job = {
        ...base,
        mode: "export",
        tool: s.tool,
        key: s.key,
        sessionId: s.id,
        host: s.host,
        hostLabel: labelOf(s.host),
        cwd: s.cwd,
        project: s.project,
        title: s.title,
        handoff: { fromHost: s.host, fromLabel: labelOf(s.host), oldCwd: s.cwd, targetCwd: input.folder || "~", openTerminal: Boolean(input.openTerminal), hideSource: input.hideSource !== false },
      };
      break;
    }
    default:
      throw new Error("unknown action");
  }

  // ── on this machine ──
  if (job.host === me()) {
    await mutate((jobs) => void jobs.unshift(job));
    if (job.mode === "stop") return finishInline(job, () => stopLocal(job));
    void pump();
    return job;
  }

  // ── on another machine ──
  const m = remote.find((r) => r.host === job.host);
  const level: RemoteReplies = m?.acceptsReplies ?? "off";
  if (level === "off") throw new Error(`${job.hostLabel} doesn't accept requests from other machines. Turn it on there: Fleet → Sharing → Replies from my other machines.`);
  if (job.access === "edit" && level !== "edit") throw new Error(`${job.hostLabel} only allows answers (no file edits) from other machines.`);
  const request = { ...job, requestedBy: me(), requestedByLabel: myLabel };

  // 1) the LAN
  try {
    if (job.mode === "thread") {
      const t = await peerFetch<Thread>(job.host, `/peer/thread?key=${encodeURIComponent(job.key!)}`, { timeoutMs: 20_000 });
      await writeJson(path.join(THREADS_DIR, `${job.id}.json`), t);
      Object.assign(job, { via: "lan", status: "done", startedAt: Date.now(), finishedAt: Date.now() });
      await mutate((jobs) => void jobs.unshift(job));
      return job;
    }
    if (job.mode === "export") {
      const pkg = await peerFetch<HandoffPackage>(job.host, `/peer/export?key=${encodeURIComponent(job.key!)}`, { timeoutMs: 60_000 });
      job.via = "lan";
      await mutate((jobs) => void jobs.unshift(job));
      return finishInline(job, () => receiveHandoff(job, pkg));
    }
    const r = await peerFetch<{ job: SessionJob }>(job.host, "/peer/request", { body: { job: request, content }, timeoutMs: job.mode === "import" ? 60_000 : 10_000 });
    Object.assign(job, resultOf({ ...job, ...r.job }), { via: "lan", status: r.job.status === "queued" ? "sent" : r.job.status });
    if (job.mode === "import" && job.status === "done" && job.handoff?.hideSource) await setHidden([job.key!], true).catch(() => {});
    await mutate((jobs) => void jobs.unshift(job));
    return job;
  } catch (e) {
    if (!(e instanceof PeerUnavailable)) throw e; // it answered with a refusal
  }

  // 2) the vault
  if (!(await groupOn())) throw new Error(`${job.hostLabel} can't be reached over the LAN, and the machine group is off here, so the vault can't carry it either.`);
  if (content) await fsp.mkdir(path.dirname(handoffFile(job.id)), { recursive: true }).then(() => fsp.writeFile(handoffFile(job.id), JSON.stringify(content), "utf8"));
  job.via = "vault";
  job.status = "sent";
  await writeJson(path.join(requestsDir(job.host), `${job.id}.json`), { v: 1, job: { ...request, via: "vault" }, sentAt: Date.now() });
  await mutate((jobs) => void jobs.unshift(job));
  return job;
}

/** Run a quick job (stop, handoff) right away and record its outcome. */
async function finishInline(job: SessionJob, run: () => Promise<Partial<SessionJob>>): Promise<SessionJob> {
  let p: Partial<SessionJob>;
  try {
    p = await run();
  } catch (e) {
    p = { status: "error", error: (e as Error).message };
  }
  return (await patchJob(job.id, { startedAt: job.startedAt ?? Date.now(), finishedAt: Date.now(), ...p })) ?? { ...job, ...p };
}

/** A handed-off session arrived at THIS machine (pull over the LAN, or from the vault). */
async function receiveHandoff(job: SessionJob, pkg: HandoffPackage): Promise<Partial<SessionJob>> {
  const h = job.handoff!;
  const r = await importSession(pkg, h.targetCwd);
  if (h.openTerminal) openTerminal(r.cwd, `claude --resume ${pkg.id}`);
  if (h.hideSource && job.key) await setHidden([job.key], true).catch(() => {});
  return { status: "done", resultKey: r.key, reply: `Moved to this machine, in ${r.cwd}.${h.openTerminal ? " Opened it in a terminal." : ""}` };
}

// ─── accepting requests from other machines ───

/**
 * A request from another machine (LAN or vault). Everything that matters is
 * re-derived from THIS machine's own data, never taken from the request.
 */
export async function acceptRequest(r: SessionJob, via: "lan" | "vault", content?: HandoffPackage): Promise<SessionJob> {
  if (!r?.id || !r.requestedBy || !ID_RE.test(r.id)) throw new Error("bad request");
  const existing = (await listJobs()).find((j) => j.id === r.id);
  if (existing) return existing;
  const settings = await readShareSettings();
  const cfg = await readConfig().catch(() => null);
  const myLabel = cfg?.label || me();
  if (settings.remoteReplies === "off") throw Object.assign(new Error(`Replies from other machines are turned off on ${myLabel}.`), { status: 403 });
  const snap = await sessionsSnapshot();
  const known = (key?: string) => snap.sessions.find((x) => x.key === key);

  const job: SessionJob = {
    id: r.id,
    mode: r.mode,
    tool: r.tool === "codex" ? "codex" : "claude",
    host: me(),
    hostLabel: myLabel,
    cwd: "",
    project: r.project,
    title: r.title,
    prompt: String(r.prompt ?? "").slice(0, MAX_PROMPT),
    access: r.access === "edit" && settings.remoteReplies === "edit" ? "edit" : "answer",
    fork: false,
    status: "queued",
    createdAt: Date.now(),
    via,
    requestedBy: r.requestedBy,
    requestedByLabel: r.requestedByLabel,
    dispatch: r.dispatch,
  };
  if (r.access === "edit" && job.access !== "edit") throw Object.assign(new Error(`${myLabel} only allows answers (no file edits) from other machines.`), { status: 403 });

  switch (r.mode) {
    case "reply":
    case "thread":
    case "export": {
      const s = known(r.key);
      if (!s) throw new Error("That session isn't on this machine.");
      Object.assign(job, { key: s.key, sessionId: s.id, tool: s.tool, cwd: s.cwd, title: s.title });
      job.fork = s.tool === "claude" && r.mode === "reply" && (Boolean(r.fork) || s.status !== "ended");
      if (r.mode === "reply" && !job.prompt.trim()) throw new Error("Empty message.");
      break;
    }
    case "new": {
      const ok = r.cwd === "~" || snap.sessions.some((x) => x.folder === r.cwd || x.cwd === r.cwd);
      if (!ok) throw new Error("That folder isn't one this machine's sessions use.");
      if (!job.prompt.trim()) throw new Error("Empty message.");
      job.cwd = r.cwd;
      break;
    }
    case "stop": {
      if (r.stopJobId) {
        const target = (await listJobs()).find((j) => j.id === r.stopJobId);
        if (!target) throw new Error("That run isn't on this machine.");
        Object.assign(job, { stopJobId: target.id, key: target.key, cwd: target.cwd });
      } else {
        const s = known(r.key);
        if (!s) throw new Error("That session isn't on this machine.");
        Object.assign(job, { key: s.key, sessionId: s.id, tool: s.tool, cwd: s.cwd, title: s.title });
      }
      break;
    }
    case "import": {
      if (!r.handoff) throw new Error("bad handoff");
      job.key = r.key;
      job.sessionId = r.sessionId;
      job.handoff = { ...r.handoff, hideSource: false };
      job.cwd = r.handoff.targetCwd;
      break;
    }
    default:
      throw new Error("unknown request");
  }

  await mutate((jobs) => {
    if (!jobs.some((j) => j.id === job.id)) jobs.unshift(job);
  });

  // quick ones run right away; AI runs wait for a slot
  if (job.mode === "stop") return finishInline(job, () => stopLocal(job));
  if (job.mode === "thread") {
    return finishInline(job, async () => {
      const t = await readThread({ key: job.key!, tool: job.tool }, 1500);
      if (!t) throw new Error("The session file isn't on this machine any more.");
      await writeJson(path.join(THREADS_DIR, `${job.id}.json`), t);
      return { status: "done" };
    });
  }
  if (job.mode === "export") {
    return finishInline(job, async () => {
      const pkg = await exportSession(job.key!);
      await fsp.mkdir(path.dirname(handoffFile(job.id)), { recursive: true });
      await fsp.writeFile(handoffFile(job.id), JSON.stringify(pkg), "utf8");
      return { status: "done", reply: `Sent through the vault.` };
    });
  }
  if (job.mode === "import") {
    return finishInline(job, async () => {
      let pkg = content;
      if (!pkg) {
        pkg = JSON.parse(await fsp.readFile(handoffFile(job.id), "utf8")) as HandoffPackage;
        await fsp.rm(handoffFile(job.id), { force: true }).catch(() => {});
      }
      const res = await importSession({ ...pkg, cwd: job.handoff!.oldCwd || pkg.cwd }, job.handoff!.targetCwd);
      if (job.handoff!.openTerminal) openTerminal(res.cwd, `claude --resume ${pkg.id}`);
      return { status: "done", resultKey: res.key, reply: `Moved to ${myLabel}, in ${res.cwd}.${job.handoff!.openTerminal ? " Opened it in a terminal there." : ""}` };
    });
  }
  if (via === "vault") await writeVaultResult(job).catch(() => {});
  void pump();
  return job;
}

// ─── running jobs on this machine ───

export function killTree(pid?: number): void {
  if (!pid) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
  else {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        /* already gone */
      }
    }
  }
}

/** shell:true joins args with spaces - quote the ones that need it. */
const q = (a: string) => (/[\s"&|<>^()]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);

function runCli(
  cmd: string,
  args: string[],
  cwd: string,
  stdin: string,
  onSpawn: (pid?: number) => void,
): Promise<{ out: string; err: string; code: number | null; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args.map(q), { cwd, shell: true, env: cleanEnv(), detached: process.platform !== "win32" });
    onSpawn(child.pid);
    let out = "";
    let err = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
    }, RUN_TIMEOUT_MS);
    child.stdout.on("data", (c: Buffer) => (out += c.toString("utf8")));
    child.stderr.on("data", (c: Buffer) => (err = (err + c.toString("utf8")).slice(-3000)));
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ out, err: e.message, code: -1, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ out, err, code, timedOut });
    });
    child.stdin.write(stdin);
    child.stdin.end();
  });
}

const homeOr = (cwd: string) => (cwd === "~" ? os.homedir() : cwd);

async function execute(job: SessionJob): Promise<Partial<SessionJob>> {
  const done = (p: Partial<SessionJob>) => ({ finishedAt: Date.now(), pid: undefined, ...p });
  const cwd = homeOr(job.cwd);
  const st = await fsp.stat(cwd).catch(() => null);
  if (!st?.isDirectory()) return done({ status: "error", error: `The folder ${cwd} doesn't exist on ${job.hostLabel} any more.` });
  const setPid = (pid?: number) => void patchJob(job.id, { pid }).catch(() => {});

  if (job.tool === "claude") {
    const args = ["-p", "--output-format", "json"];
    if (job.mode === "reply") {
      args.push("--resume", job.sessionId!);
      if (job.fork) args.push("--fork-session");
    }
    if (job.access === "edit") args.push("--permission-mode", "acceptEdits");
    const r = await runCli("claude", args, cwd, job.prompt, setPid);
    const cur = (await listJobs()).find((x) => x.id === job.id);
    if (cur && !isActive(cur)) return {}; // stopped meanwhile - keep that outcome
    if (r.timedOut) return done({ status: "error", error: "Stopped after 20 minutes." });
    try {
      const j = JSON.parse(r.out) as { result?: string; is_error?: boolean; session_id?: string; total_cost_usd?: number };
      return done({
        status: j.is_error ? "error" : "done",
        reply: j.result ?? "",
        error: j.is_error ? j.result || "Claude reported an error" : undefined,
        resultKey: j.session_id ? `claude:${j.session_id}` : job.key,
        costUsd: j.total_cost_usd,
      });
    } catch {
      const text = r.out.trim();
      return done({ status: "error", error: (text || r.err.trim() || `claude exited with code ${r.code}`).slice(-800) });
    }
  }

  // Codex
  const outFile = path.join(os.tmpdir(), `mc-codex-${job.id}.txt`);
  const args = ["exec"];
  if (job.mode === "reply") args.push("resume", job.sessionId!);
  args.push("-", "--skip-git-repo-check", "-o", outFile);
  if (job.access === "edit") args.push("-c", "sandbox_mode=workspace-write");
  const r = await runCli("codex", args, cwd, job.prompt, setPid);
  const reply = await fsp.readFile(outFile, "utf8").catch(() => "");
  await fsp.rm(outFile, { force: true }).catch(() => {});
  const cur = (await listJobs()).find((x) => x.id === job.id);
  if (cur && !isActive(cur)) return {};
  if (r.timedOut) return done({ status: "error", error: "Stopped after 20 minutes.", reply });
  if (r.code !== 0 && !reply.trim()) return done({ status: "error", error: (r.err.trim() || `codex exited with code ${r.code}`).slice(-800) });
  return done({ status: "done", reply, resultKey: job.mode === "reply" ? job.key : undefined });
}

let pumping = false;
/**
 * Start queued local AI runs, at most MAX_RUNNING at a time. The background
 * tick runs in a different module instance than the API route, so it only
 * picks up jobs older than `minAgeMs` (the route starts its own at once).
 */
async function pump(minAgeMs = 0): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    for (;;) {
      const next = await mutate((jobs) => {
        const running = jobs.filter((j) => j.host === me() && j.status === "running").length;
        if (running >= MAX_RUNNING) return undefined;
        const j = [...jobs].reverse().find((x) => x.host === me() && x.status === "queued" && (x.mode === "reply" || x.mode === "new") && Date.now() - x.createdAt >= minAgeMs);
        if (!j) return undefined;
        j.status = "running";
        j.startedAt = Date.now();
        return { ...j };
      });
      if (!next) break;
      if (next.requestedBy && next.via === "vault") await writeVaultResult(next).catch(() => {});
      void execute(next)
        .catch((e: Error): Partial<SessionJob> => ({ status: "error", error: e.message, finishedAt: Date.now() }))
        .then((p) => (Object.keys(p).length ? patchJob(next.id, p) : undefined))
        .then(() => pump());
    }
  } finally {
    pumping = false;
  }
}

// ─── stop ───

function processesMatching(needle: string): number[] {
  if (!/^[\w-]+$/.test(needle)) return [];
  if (process.platform === "win32") {
    const r = spawnSync(
      "powershell",
      ["-NoProfile", "-Command", `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match '${needle}' -and $_.Name -match 'codex|node' } | ForEach-Object { $_.ProcessId }`],
      { encoding: "utf8" },
    );
    return (r.stdout || "").split(/\s+/).map(Number).filter((n) => n > 0 && n !== process.pid);
  }
  const r = spawnSync("ps", ["-ax", "-o", "pid=,command="], { encoding: "utf8" });
  return (r.stdout || "")
    .split("\n")
    .filter((l) => l.includes(needle) && /codex/.test(l))
    .map((l) => Number(l.trim().split(/\s+/)[0]))
    .filter((n) => n > 0 && n !== process.pid);
}

async function stopLocal(job: SessionJob): Promise<Partial<SessionJob>> {
  const jobs = await listJobs();
  // a Mission Control run: by id, or the run currently replying to this session
  const run = jobs.find(
    (x) => x.host === me() && x.status === "running" && x.id !== job.id && ((job.stopJobId && x.id === job.stopJobId) || (!job.stopJobId && job.key && (x.key === job.key || x.resultKey === job.key))),
  );
  if (run) {
    // record the stop first: the run notices its process died and must keep this outcome
    await patchJob(run.id, { status: "error", error: `Stopped${job.requestedByLabel ? ` from ${job.requestedByLabel}` : ""}.`, finishedAt: Date.now(), pid: undefined });
    killTree(run.pid);
    return { status: "done", reply: `Stopped the ${productName()} run.` };
  }
  if (job.stopJobId) {
    const j = jobs.find((x) => x.id === job.stopJobId);
    if (j && j.status === "queued") {
      await patchJob(j.id, { status: "error", error: "Cancelled.", finishedAt: Date.now() });
      return { status: "done", reply: "Cancelled before it started." };
    }
    throw new Error("That run isn't running any more.");
  }
  const snap = await sessionsSnapshot();
  const s = snap.sessions.find((x) => x.key === job.key);
  if (!s) throw new Error("That session isn't on this machine.");
  if (s.tool === "claude") {
    const p = (await liveClaudeProcesses()).get(s.id);
    if (!p) throw new Error("That session isn't running.");
    killTree(p.pid);
    return { status: "done", reply: `Stopped ${s.title}.` };
  }
  const pids = processesMatching(s.id);
  if (!pids.length) throw new Error("This Codex session runs inside the Codex app - stop it there.");
  for (const pid of pids) killTree(pid);
  return { status: "done", reply: `Stopped ${s.title}.` };
}

// ─── the background tick (every machine) ───

let ticking = false;
export async function sessionJobsTick(minAgeMs = 10_000): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    await mutate((jobs) => {
      for (const j of jobs) {
        if (j.host === me() && j.status === "running" && Date.now() - (j.startedAt ?? j.createdAt) > RUN_TIMEOUT_MS + 5 * 60_000) {
          Object.assign(j, { status: "error", error: `Interrupted (${productName()} restarted while it ran).`, finishedAt: Date.now(), pid: undefined });
        }
      }
    });
    if (await groupOn()) await takeVaultRequests();
    await collectResults();
    await pump(minAgeMs);
  } finally {
    ticking = false;
  }
}

/** Requests other machines left for this one in the vault. */
async function takeVaultRequests(): Promise<void> {
  const dir = requestsDir(me());
  const names = await fsp.readdir(dir).catch(() => [] as string[]);
  for (const n of names) {
    if (!n.endsWith(".json")) continue;
    const file = path.join(dir, n);
    let req: { job?: SessionJob; sentAt?: number };
    try {
      req = JSON.parse(await fsp.readFile(file, "utf8"));
    } catch {
      continue; // mid-sync
    }
    await fsp.rm(file, { force: true }).catch(() => {});
    const r = req.job;
    if (!r?.id || !ID_RE.test(r.id)) continue;
    if (Date.now() - (req.sentAt ?? 0) > REMOTE_EXPIRE_MS) {
      await writeJson(path.join(dir, "results", `${r.id}.json`), { id: r.id, status: "error", error: "The request arrived too late (over 30 minutes in transit).", finishedAt: Date.now() }).catch(() => {});
      continue;
    }
    try {
      const job = await acceptRequest(r, "vault");
      await writeVaultResult(job).catch(() => {});
    } catch (e) {
      await writeJson(path.join(dir, "results", `${r.id}.json`), { id: r.id, status: "error", error: (e as Error).message, finishedAt: Date.now() }).catch(() => {});
    }
  }
}

let lastLanPoll = 0;
/** Fast LAN progress poll for in-flight jobs (the page calls this while it waits). */
export async function refreshLanJobs(): Promise<void> {
  if (Date.now() - lastLanPoll < 2_000) return;
  lastLanPoll = Date.now();
  const mine = (await listJobs()).filter((j) => j.host !== me() && !j.requestedBy && isActive(j) && j.via === "lan");
  await Promise.all(mine.map((j) => collectOne(j)));
}

async function collectOne(j: SessionJob): Promise<void> {
  let res: (Partial<SessionJob> & { thread?: Thread }) | null = null;
  if (j.via === "lan") {
    try {
      res = await peerFetch(j.host, `/peer/job?id=${encodeURIComponent(j.id)}`, { timeoutMs: 4_000 });
    } catch (e) {
      if (!(e instanceof PeerUnavailable)) res = { status: "error", error: (e as Error).message };
    }
  } else {
    const file = path.join(requestsDir(j.host), "results", `${j.id}.json`);
    try {
      res = JSON.parse(await fsp.readFile(file, "utf8"));
    } catch {
      res = null;
    }
  }
  if (res?.status) {
    const final = !ACTIVE.includes(res.status);
    if (res.thread) await writeJson(path.join(THREADS_DIR, `${j.id}.json`), res.thread);
    const patch: Partial<SessionJob> = {
      status: res.status === "queued" ? "sent" : res.status,
      startedAt: res.startedAt,
      finishedAt: res.finishedAt,
      reply: res.reply,
      error: res.error,
      resultKey: res.resultKey,
      costUsd: res.costUsd,
    };
    // a pulled session waits in the vault: import it here
    if (j.mode === "export" && res.status === "done" && j.via === "vault") {
      try {
        const pkg = JSON.parse(await fsp.readFile(handoffFile(j.id), "utf8")) as HandoffPackage;
        Object.assign(patch, await receiveHandoff(j, pkg));
        await fsp.rm(handoffFile(j.id), { force: true }).catch(() => {});
      } catch (e) {
        if (Date.now() - (res.finishedAt ?? Date.now()) < 10 * 60_000) return; // the file may still be syncing
        Object.assign(patch, { status: "error", error: `The session didn't arrive through the vault: ${(e as Error).message}` });
      }
    }
    if (j.mode === "import" && res.status === "done" && j.handoff?.hideSource && j.key) await setHidden([j.key], true).catch(() => {});
    await patchJob(j.id, patch);
    if (final && j.via !== "lan") await fsp.rm(path.join(requestsDir(j.host), "results", `${j.id}.json`), { force: true }).catch(() => {});
    return;
  }
  if (Date.now() - j.createdAt > REMOTE_EXPIRE_MS) {
    await patchJob(j.id, {
      status: "expired",
      error: `No answer from ${j.hostLabel} in 30 minutes. Is ${productName()} running there, with "Replies from my other machines" turned on?`,
      finishedAt: Date.now(),
    });
    await fsp.rm(path.join(requestsDir(j.host), `${j.id}.json`), { force: true }).catch(() => {});
    await fsp.rm(handoffFile(j.id), { force: true }).catch(() => {});
  }
}

/** Progress / results for jobs this machine sent to others. */
async function collectResults(): Promise<void> {
  const mine = (await listJobs()).filter((j) => j.host !== me() && !j.requestedBy && isActive(j));
  for (const j of mine) await collectOne(j).catch(() => {});
}

export async function readJobThread(id: string): Promise<Thread | null> {
  if (!ID_RE.test(id)) return null;
  return (await readThreadFile(id)) ?? null;
}

// ─── open things on this machine ───

export type OpenWhat = "terminal" | "folder" | "editor";

function haveCommand(cmd: string): boolean {
  const r = spawnSync(process.platform === "win32" ? "where" : "which", [cmd], { stdio: "ignore" });
  return r.status === 0;
}

function launchDetached(cmd: string, args: string[], opts: { cwd?: string; verbatim?: boolean; shell?: boolean } = {}): void {
  const child = spawn(cmd, args, {
    cwd: opts.cwd,
    detached: true,
    stdio: "ignore",
    env: cleanEnv(false), // an interactive session you'll use: its alerts count
    shell: opts.shell,
    windowsVerbatimArguments: opts.verbatim,
  });
  child.on("error", () => {});
  child.unref();
}

export function openTerminal(cwd: string, command: string): void {
  if (process.platform === "win32") {
    const wt = path.join(process.env.LOCALAPPDATA ?? "", "Microsoft", "WindowsApps", "wt.exe");
    if (fs.existsSync(wt)) launchDetached(wt, ["-d", cwd, "cmd", "/k", command]);
    else launchDetached("cmd.exe", ["/c", `start "${productName()}" /D "${cwd}" cmd /k ${command}`], { verbatim: true });
  } else if (process.platform === "darwin") {
    const sh = `cd '${cwd.replace(/'/g, `'\\''`)}' && ${command}`;
    const as = sh.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    launchDetached("osascript", ["-e", `tell application "Terminal" to do script "${as}"`, "-e", 'tell application "Terminal" to activate']);
  } else {
    throw new Error("Opening a terminal is only supported on Windows and macOS.");
  }
}

/** The command that resumes a session interactively. */
export function resumeCommand(s: Pick<SessionSummary, "tool" | "id">): string {
  return s.tool === "claude" ? `claude --resume ${s.id}` : `codex resume ${s.id}`;
}

export async function openLocal(what: OpenWhat, target: { key?: string; folder?: string; tool?: SessionTool }): Promise<string> {
  const snap = await sessionsSnapshot();
  let cwd: string;
  let command: string;
  if (target.key) {
    const s = snap.sessions.find((x) => x.key === target.key);
    if (!s) throw new Error("That session isn't on this machine.");
    cwd = what === "terminal" ? s.cwd : s.folder || s.cwd;
    command = resumeCommand(s);
  } else {
    const folder = target.folder ?? "";
    if (!folder || !snap.sessions.some((s) => s.folder === folder || s.cwd === folder)) throw new Error("That folder isn't one of this machine's projects.");
    cwd = folder;
    command = target.tool === "codex" ? "codex" : "claude";
  }
  const st = await fsp.stat(cwd).catch(() => null);
  if (!st?.isDirectory()) throw new Error(`The folder ${cwd} doesn't exist any more.`);

  if (what === "terminal") {
    openTerminal(cwd, command);
    return `Opened a terminal running ${command.split(" ").slice(0, 2).join(" ")}.`;
  }
  if (what === "folder") {
    if (process.platform === "win32") launchDetached("explorer.exe", [cwd]);
    else launchDetached("open", [cwd]);
    return "Opened the folder.";
  }
  if (!haveCommand("code")) throw new Error("VS Code's `code` command isn't installed on this machine.");
  launchDetached("code", [q(cwd)], { shell: true });
  return "Opened the folder in VS Code.";
}
