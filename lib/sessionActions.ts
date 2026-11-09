import { spawn, spawnSync } from "child_process";
import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { cleanEnv } from "./runners";
import { sessionsSnapshot, type SessionSummary, type SessionTool } from "./sessions";
import { mergeRemoteSessions, readShareSettings, type RemoteReplies } from "./sessionShare";
import { readConfig } from "./cluster";
import { vaultAvailable, vaultInfo } from "./vault";
import { readThread, type Thread } from "./sessionThread";

/**
 * Acting on sessions from the Projects page:
 *
 *  - reply   continue an existing Claude Code / Codex session with a new
 *            message (claude -p --resume <id>, codex exec resume <id>), in the
 *            session's own folder. The turn lands in the real session, so the
 *            desktop app / CLI shows it too. A session that is open right now
 *            is forked instead (--fork-session) so the two can't collide.
 *  - new     start a new session in a project's folder.
 *  - thread  fetch the full thread (tool calls included) of a session that
 *            lives on another machine.
 *  - open    terminal / folder / VS Code, on this machine only.
 *
 * Sessions on OTHER machines are reached through the vault, like everything
 * else in the machine group (no open ports):
 *
 *   Agentic OS/Cluster/requests/<target-host>/<job-id>.json           request
 *   Agentic OS/Cluster/requests/<target-host>/results/<job-id>.json   progress + result
 *
 * The target only acts when ITS "Replies from my other machines" setting
 * allows it (Fleet → Sharing; off by default), only on sessions / folders it
 * actually has, and never with more access than that setting grants.
 *
 * data/session-jobs.json is the source of truth (re-read on every call).
 */

export type JobMode = "reply" | "new" | "thread";
export type JobAccess = "answer" | "edit";
export type JobStatus = "queued" | "sent" | "running" | "done" | "error" | "expired";

export interface SessionJob {
  id: string;
  mode: JobMode;
  tool: SessionTool;
  /** session replied to / whose thread was asked for */
  key?: string;
  sessionId?: string;
  /** machine that runs it */
  host: string;
  hostLabel: string;
  cwd: string;
  project?: string;
  prompt: string;
  access: JobAccess;
  fork: boolean;
  status: JobStatus;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  reply?: string;
  error?: string;
  /** the session the reply landed in (differs from `key` when forked / new) */
  resultKey?: string;
  costUsd?: number;
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
  if (job?.requestedBy) await writeRemoteResult(job).catch(() => {});
  return job;
}

export async function dismissJob(id: string): Promise<void> {
  await mutate((jobs) => {
    const i = jobs.findIndex((j) => j.id === id && !ACTIVE.includes(j.status));
    if (i >= 0) jobs.splice(i, 1);
  });
  await fsp.rm(path.join(THREADS_DIR, `${id}.json`), { force: true }).catch(() => {});
}

let seq = 0;
const newId = () => `sj-${Date.now().toString(36)}-${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// ─── the machine group ───

function requestsDir(host: string): string {
  return path.join(vaultInfo().base, "Cluster", "requests", host.replace(/[^A-Za-z0-9_-]+/g, "_"));
}

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

async function writeRemoteResult(job: SessionJob): Promise<void> {
  if (!job.requestedBy) return;
  const res: Partial<SessionJob> & { id: string; thread?: Thread } = {
    id: job.id,
    status: job.status,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    reply: job.reply,
    error: job.error,
    resultKey: job.resultKey,
    costUsd: job.costUsd,
  };
  if (job.mode === "thread" && job.status === "done") {
    res.thread = JSON.parse(await fsp.readFile(path.join(THREADS_DIR, `${job.id}.json`), "utf8")) as Thread;
  }
  await writeJson(path.join(requestsDir(me()), "results", `${job.id}.json`), res);
}

// ─── starting jobs ───

export interface StartInput {
  mode: JobMode;
  /** reply / thread: the session */
  key?: string;
  /** new: the folder to start in, the machine that has it, and the tool */
  folder?: string;
  host?: string;
  tool?: SessionTool;
  project?: string;
  prompt?: string;
  access?: JobAccess;
  /** reply: fork instead of continuing in place (forced on for a session that is open right now) */
  fork?: boolean;
}

export async function startJob(input: StartInput): Promise<SessionJob> {
  const snap = await sessionsSnapshot();
  const { sessions, remote } = await mergeRemoteSessions(snap.sessions);
  const cfg = await readConfig().catch(() => null);
  const myLabel = cfg?.label || me();
  const prompt = (input.prompt ?? "").trim();
  const access: JobAccess = input.access === "edit" ? "edit" : "answer";
  if (input.mode !== "thread" && !prompt) throw new Error("Write a message first.");
  if (prompt.length > MAX_PROMPT) throw new Error(`That message is too long (max ${MAX_PROMPT.toLocaleString()} characters).`);

  let job: SessionJob;
  if (input.mode === "reply" || input.mode === "thread") {
    const s = sessions.find((x) => x.key === input.key);
    if (!s) throw new Error("That session isn't in the list any more.");
    const local = s.host === me();
    if (input.mode === "thread" && local) throw new Error("This session is on this machine - read it directly.");
    const busy = s.status !== "ended";
    job = {
      id: newId(),
      mode: input.mode,
      tool: s.tool,
      key: s.key,
      sessionId: s.id,
      host: s.host,
      hostLabel: local ? myLabel : (remote.find((r) => r.host === s.host)?.label ?? s.host),
      cwd: s.cwd,
      project: s.project,
      prompt,
      access,
      // Codex can't fork; Claude forks when asked or when the session is open right now
      fork: s.tool === "claude" && input.mode === "reply" && (Boolean(input.fork) || (local && busy)),
      status: "queued",
      createdAt: Date.now(),
    };
  } else {
    const host = input.host || me();
    const tool: SessionTool = input.tool === "codex" ? "codex" : "claude";
    const folder = input.folder ?? "";
    // only folders that sessions on that machine actually used - never an arbitrary path
    const known = sessions.some((s) => s.host === host && (s.folder === folder || s.cwd === folder));
    if (!folder || !known) throw new Error("Pick a project that has a folder first.");
    job = {
      id: newId(),
      mode: "new",
      tool,
      host,
      hostLabel: host === me() ? myLabel : (remote.find((r) => r.host === host)?.label ?? host),
      cwd: folder,
      project: input.project,
      prompt,
      access,
      fork: false,
      status: "queued",
      createdAt: Date.now(),
    };
  }

  if (job.host !== me()) {
    const m = remote.find((r) => r.host === job.host);
    const level: RemoteReplies = m?.acceptsReplies ?? "off";
    if (!(await groupOn())) throw new Error("The machine group is off on this machine, so it can't reach the others.");
    if (level === "off") throw new Error(`${job.hostLabel} doesn't accept replies from other machines. Turn it on there: Fleet → Sharing → Replies from my other machines.`);
    if (job.access === "edit" && level !== "edit") throw new Error(`${job.hostLabel} only allows answers (no file edits) from other machines.`);
    job.status = "sent";
    await writeJson(path.join(requestsDir(job.host), `${job.id}.json`), {
      v: 1,
      job: { ...job, requestedBy: me(), requestedByLabel: myLabel },
      sentAt: Date.now(),
    });
    await mutate((jobs) => void jobs.unshift(job));
    return job;
  }

  await mutate((jobs) => void jobs.unshift(job));
  void pump();
  return job;
}

// ─── running jobs on this machine ───

function killTree(pid?: number): void {
  if (!pid) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
  else {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
}

/** shell:true joins args with spaces - quote the ones that need it. */
const q = (a: string) => (/[\s"&|<>^()]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);

function runCli(cmd: string, args: string[], cwd: string, stdin: string): Promise<{ out: string; err: string; code: number | null; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args.map(q), { cwd, shell: true, env: cleanEnv(), detached: process.platform !== "win32" });
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

async function execute(job: SessionJob): Promise<Partial<SessionJob>> {
  const done = (p: Partial<SessionJob>) => ({ finishedAt: Date.now(), ...p });
  if (job.mode === "thread") {
    const t = await readThread({ key: job.key!, tool: job.tool }, 1500);
    if (!t) return done({ status: "error", error: "The session file isn't on this machine any more." });
    await writeJson(path.join(THREADS_DIR, `${job.id}.json`), t);
    return done({ status: "done" });
  }
  const st = await fsp.stat(job.cwd).catch(() => null);
  if (!st?.isDirectory()) return done({ status: "error", error: `The folder ${job.cwd} doesn't exist on ${job.hostLabel} any more.` });

  if (job.tool === "claude") {
    const args = ["-p", "--output-format", "json"];
    if (job.mode === "reply") {
      args.push("--resume", job.sessionId!);
      if (job.fork) args.push("--fork-session");
    }
    if (job.access === "edit") args.push("--permission-mode", "acceptEdits");
    const r = await runCli("claude", args, job.cwd, job.prompt);
    if (r.timedOut) return done({ status: "error", error: "Stopped after 20 minutes." });
    try {
      const j = JSON.parse(r.out) as { result?: string; is_error?: boolean; session_id?: string; total_cost_usd?: number };
      return done({
        status: j.is_error ? "error" : "done",
        reply: j.result ?? "",
        error: j.is_error ? (j.result || "Claude reported an error") : undefined,
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
  const r = await runCli("codex", args, job.cwd, job.prompt);
  const reply = await fsp.readFile(outFile, "utf8").catch(() => "");
  await fsp.rm(outFile, { force: true }).catch(() => {});
  if (r.timedOut) return done({ status: "error", error: "Stopped after 20 minutes.", reply });
  if (r.code !== 0 && !reply.trim()) return done({ status: "error", error: (r.err.trim() || `codex exited with code ${r.code}`).slice(-800) });
  return done({ status: "done", reply, resultKey: job.mode === "reply" ? job.key : undefined });
}

let pumping = false;
/**
 * Start queued local jobs, at most MAX_RUNNING at a time. The background tick
 * runs in a different module instance than the API route, so it only picks up
 * jobs older than `minAgeMs` (the route starts its own at once) - that keeps
 * the two from starting the same job.
 */
async function pump(minAgeMs = 0): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    for (;;) {
      const next = await mutate((jobs) => {
        const running = jobs.filter((j) => j.host === me() && j.status === "running").length;
        if (running >= MAX_RUNNING) return undefined;
        const j = [...jobs].reverse().find((x) => x.host === me() && x.status === "queued" && Date.now() - x.createdAt >= minAgeMs);
        if (!j) return undefined;
        j.status = "running";
        j.startedAt = Date.now();
        return { ...j };
      });
      if (!next) break;
      if (next.requestedBy) await writeRemoteResult(next).catch(() => {});
      void execute(next)
        .catch((e: Error): Partial<SessionJob> => ({ status: "error", error: e.message, finishedAt: Date.now() }))
        .then((p) => patchJob(next.id, p))
        .then(() => pump());
    }
  } finally {
    pumping = false;
  }
}

// ─── the background tick (every machine) ───

let ticking = false;
export async function sessionJobsTick(minAgeMs = 10_000): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    // local runs that outlived their process (Mission Control restarted mid-run)
    await mutate((jobs) => {
      for (const j of jobs) {
        if (j.host === me() && j.status === "running" && Date.now() - (j.startedAt ?? j.createdAt) > RUN_TIMEOUT_MS + 5 * 60_000) {
          Object.assign(j, { status: "error", error: "Interrupted (Mission Control restarted while it ran).", finishedAt: Date.now() });
        }
      }
    });
    if (await groupOn()) {
      await takeRequests();
      await collectResults();
    }
    await pump(minAgeMs);
  } finally {
    ticking = false;
  }
}

/** Requests other machines left for this one. */
async function takeRequests(): Promise<void> {
  const dir = requestsDir(me());
  const names = await fsp.readdir(dir).catch(() => [] as string[]);
  if (!names.some((n) => n.endsWith(".json"))) return;
  const settings = await readShareSettings();
  const snap = await sessionsSnapshot();
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
    if (!r?.id || !r.requestedBy || !/^sj-[\w-]+$/.test(r.id)) continue;
    const refuse = (error: string) =>
      writeJson(path.join(dir, "results", `${r.id}.json`), { id: r.id, status: "error", error, finishedAt: Date.now() }).catch(() => {});
    if (Date.now() - (req.sentAt ?? 0) > REMOTE_EXPIRE_MS) {
      await refuse("The request arrived too late (over 30 minutes in transit).");
      continue;
    }
    if (settings.remoteReplies === "off") {
      await refuse(`Replies from other machines are turned off on ${r.hostLabel}.`);
      continue;
    }
    // re-derive everything that matters from THIS machine's own data, never from the request
    let cwd: string;
    let tool: SessionTool;
    let sessionId: string | undefined;
    let fork = false;
    if (r.mode === "reply" || r.mode === "thread") {
      const s = snap.sessions.find((x) => x.key === r.key);
      if (!s) {
        await refuse("That session isn't on this machine.");
        continue;
      }
      [cwd, tool, sessionId] = [s.cwd, s.tool, s.id];
      fork = s.tool === "claude" && r.mode === "reply" && (Boolean(r.fork) || s.status !== "ended");
    } else if (r.mode === "new") {
      const ok = snap.sessions.some((s) => s.folder === r.cwd || s.cwd === r.cwd);
      if (!ok) {
        await refuse("That folder isn't one this machine's sessions use.");
        continue;
      }
      [cwd, tool] = [r.cwd, r.tool === "codex" ? "codex" : "claude"];
    } else continue;
    const access: JobAccess = r.access === "edit" && settings.remoteReplies === "edit" ? "edit" : "answer";
    if (r.access === "edit" && access !== "edit") {
      await refuse(`${r.hostLabel} only allows answers (no file edits) from other machines.`);
      continue;
    }
    const job: SessionJob = {
      id: r.id,
      mode: r.mode,
      tool,
      key: r.mode === "new" ? undefined : r.key,
      sessionId,
      host: me(),
      hostLabel: r.hostLabel,
      cwd,
      project: r.project,
      prompt: String(r.prompt ?? "").slice(0, MAX_PROMPT),
      access,
      fork,
      status: "queued",
      createdAt: Date.now(),
      requestedBy: r.requestedBy,
      requestedByLabel: r.requestedByLabel,
    };
    if (job.mode !== "thread" && !job.prompt.trim()) continue;
    await mutate((jobs) => {
      if (!jobs.some((j) => j.id === job.id)) jobs.unshift(job);
    });
    await writeRemoteResult(job).catch(() => {});
  }
}

/** Progress / results for jobs this machine sent to others. */
async function collectResults(): Promise<void> {
  const mine = (await listJobs()).filter((j) => j.host !== me() && !j.requestedBy && ACTIVE.includes(j.status));
  for (const j of mine) {
    const file = path.join(requestsDir(j.host), "results", `${j.id}.json`);
    let res: (Partial<SessionJob> & { thread?: Thread }) | null = null;
    try {
      res = JSON.parse(await fsp.readFile(file, "utf8"));
    } catch {
      res = null;
    }
    if (res?.status) {
      const final = !ACTIVE.includes(res.status);
      if (res.thread) await writeJson(path.join(THREADS_DIR, `${j.id}.json`), res.thread);
      await patchJob(j.id, {
        status: res.status === "queued" ? "sent" : res.status,
        startedAt: res.startedAt,
        finishedAt: res.finishedAt,
        reply: res.reply,
        error: res.error,
        resultKey: res.resultKey,
        costUsd: res.costUsd,
      });
      if (final) await fsp.rm(file, { force: true }).catch(() => {});
      continue;
    }
    if (Date.now() - j.createdAt > REMOTE_EXPIRE_MS) {
      await patchJob(j.id, {
        status: "expired",
        error: `No answer from ${j.hostLabel} in 30 minutes. Is Mission Control running there, with "Replies from my other machines" turned on?`,
        finishedAt: Date.now(),
      });
      await fsp.rm(path.join(requestsDir(j.host), `${j.id}.json`), { force: true }).catch(() => {});
    }
  }
}

export async function readJobThread(id: string): Promise<Thread | null> {
  if (!/^sj-[\w-]+$/.test(id)) return null;
  try {
    return JSON.parse(await fsp.readFile(path.join(THREADS_DIR, `${id}.json`), "utf8")) as Thread;
  } catch {
    return null;
  }
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
    env: cleanEnv(),
    shell: opts.shell,
    windowsVerbatimArguments: opts.verbatim,
  });
  child.on("error", () => {});
  child.unref();
}

function openTerminal(cwd: string, command: string): void {
  if (process.platform === "win32") {
    const wt = path.join(process.env.LOCALAPPDATA ?? "", "Microsoft", "WindowsApps", "wt.exe");
    if (fs.existsSync(wt)) launchDetached(wt, ["-d", cwd, "cmd", "/k", command]);
    else launchDetached("cmd.exe", ["/c", `start "Mission Control" /D "${cwd}" cmd /k ${command}`], { verbatim: true });
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
