import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { cleanEnv } from "./runners";

/**
 * Updating Mission Control on any machine from Fleet → Versions.
 *
 *  - Every build is stamped with the commit it was built from (scripts/stamp-build.mjs →
 *    .next/mc-build.json). At start the server copies that stamp with its own pid to
 *    data/running-build.json, so "what this machine serves" is the build that was running
 *    when the server started, not whatever was built since.
 *  - Each machine publishes its stamp in its shared session summary (lib/sessionShare.ts).
 *    The machine you look from fetches origin and works out how far behind each one is,
 *    so the others never need to fetch just to be shown.
 *  - An update is a job like a reply (mode "update" in lib/sessionActions.ts): it travels
 *    over the LAN or the vault, the target re-checks its own settings, and waits until
 *    nothing Mission Control started is running there (updateBlockers). Then a detached
 *    script (scripts/self-update.ps1 / .sh) pulls from that machine's OWN git remote,
 *    installs packages if they changed, builds, and restarts the server. A failed build
 *    goes back to the commit it came from and rebuilds that, so the machine keeps working.
 *    A request carries no code, no command and no address: the worst another machine (or
 *    anything that writes to the vault) can do is ask a machine to install what the owner
 *    already pushed to GitHub.
 */

export interface BuildInfo {
  commit: string;
  short: string;
  subject: string;
  /** commit time */
  at: number;
  branch: string;
  dirty?: boolean;
  builtAt: number;
}

/** Version of the update contract. A machine that does not publish it needs update.cmd once, by hand. */
export const SELF_UPDATE = 1;

const REPO = process.cwd();
const DATA = path.join(REPO, "data");
const STAMP_FILE = path.join(REPO, ".next", "mc-build.json");
const RUNNING_FILE = path.join(DATA, "running-build.json");
const STATUS_FILE = path.join(DATA, "update-status.json");
const ORIGIN_FILE = path.join(DATA, "update-origin.json");
const ORIGIN_TTL_MS = 30 * 60_000;

export const COMMIT_RE = /^[0-9a-f]{7,40}$/;
const BRANCH_RE = /^[\w./-]{1,100}$/;

const readJson = <T>(file: string): T | null => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")) as T;
  } catch {
    return null;
  }
};

function writeJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

/** Called once at server start (lib/scheduler.ts): remember which build this process serves. */
export function recordRunningBuild(): void {
  const stamp = readJson<BuildInfo>(STAMP_FILE);
  try {
    writeJson(RUNNING_FILE, { ...(stamp ?? {}), pid: process.pid, startedAt: Date.now() });
  } catch {
    /* data/ not writable: buildInfo() falls back to the stamp */
  }
}

/** The build this server process is serving (null = built before builds were stamped). */
export function buildInfo(): BuildInfo | null {
  const running = readJson<BuildInfo & { pid?: number }>(RUNNING_FILE);
  if (running?.pid === process.pid) return running.commit ? running : null;
  const stamp = readJson<BuildInfo>(STAMP_FILE);
  return stamp?.commit ? stamp : null;
}

/** The build on disk - differs from buildInfo() when something was built and the server not restarted yet. */
export function diskBuild(): BuildInfo | null {
  const stamp = readJson<BuildInfo>(STAMP_FILE);
  return stamp?.commit ? stamp : null;
}

/** Only the scheduler's module instance starts updates (it is the one that can see project-run steps in flight). */
let schedulerInstance = false;
export function markSchedulerInstance(): void {
  schedulerInstance = true;
}
export const isSchedulerInstance = () => schedulerInstance;

// ─── git, without blocking the server ───

function run(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    let out = "";
    let done = false;
    const child = spawn(cmd, args, { cwd: REPO, windowsHide: true, env: cleanEnv() });
    const t = setTimeout(() => {
      if (!done) child.kill();
    }, timeoutMs);
    child.stdout?.on("data", (d) => (out += d));
    child.stderr?.on("data", (d) => (out += d));
    child.on("error", () => {
      done = true;
      clearTimeout(t);
      resolve({ code: -1, out });
    });
    child.on("close", (code) => {
      done = true;
      clearTimeout(t);
      resolve({ code: code ?? -1, out: out.trim() });
    });
  });
}

export interface OriginInfo {
  branch: string;
  commit: string;
  short: string;
  subject: string;
  at: number;
  fetchedAt: number;
  error?: string;
}

let fetching: Promise<OriginInfo | null> | null = null;

/** The newest commit on GitHub for this install's branch (git fetch at most every 30 minutes, or when asked). */
export function originInfo(force = false): Promise<OriginInfo | null> {
  const cached = readJson<OriginInfo>(ORIGIN_FILE);
  if (cached && !force && Date.now() - cached.fetchedAt < ORIGIN_TTL_MS) return Promise.resolve(cached);
  if (fetching) return fetching;
  fetching = (async () => {
    const b = buildInfo()?.branch || (await run("git", ["branch", "--show-current"], 10_000)).out || "main";
    const branch = BRANCH_RE.test(b) ? b : "main";
    const f = await run("git", ["fetch", "--quiet", "origin", branch], 90_000);
    const log = await run("git", ["log", "-1", "--format=%H%x1f%s%x1f%ct", `origin/${branch}`], 10_000);
    const [commit = "", subject = "", at = "0"] = log.code === 0 ? log.out.split("\x1f") : [];
    const info: OriginInfo = {
      branch,
      commit,
      short: commit.slice(0, 7),
      subject: subject.slice(0, 160),
      at: Number(at) * 1000,
      fetchedAt: Date.now(),
      error: f.code !== 0 ? `git fetch failed: ${f.out.split(/\r?\n/).slice(-2).join(" ").slice(0, 200)}` : undefined,
    };
    if (!info.commit && cached) return { ...cached, error: info.error };
    try {
      writeJson(ORIGIN_FILE, info);
    } catch {
      /* shown anyway */
    }
    return info;
  })().finally(() => {
    fetching = null;
  });
  return fetching;
}

/**
 * How far a machine's build is from GitHub, worked out in THIS machine's clone. Null when the
 * commit isn't known here (a machine with its own local commits, or this clone not fetched yet).
 * The commit comes from another machine's summary, so it is checked before it reaches git.
 */
export async function compareToOrigin(commit: string | undefined, origin: OriginInfo | null): Promise<{ behind: number; ahead: number } | null> {
  if (!commit || !COMMIT_RE.test(commit) || !origin?.commit) return null;
  if (commit === origin.commit) return { behind: 0, ahead: 0 };
  const r = await run("git", ["rev-list", "--left-right", "--count", `${commit}...origin/${origin.branch}`], 15_000);
  const m = r.code === 0 ? r.out.match(/^(\d+)\s+(\d+)$/) : null;
  return m ? { ahead: Number(m[1]), behind: Number(m[2]) } : null;
}

// ─── is anything running that a restart would kill? ───

// A CLI that Mission Control started (directly, or through cmd.exe /c). The Hermes dashboard and
// Ollama are started detached by lib/daemons.ts and outlive the server, so they don't count.
const AGENT_RE = /\b(claude|codex|hermes|openclaw|gemini|kimi|ollama)(\.exe|\.cmd|\.ps1)?\b|\bnpm(\.cmd)?\b.*\brun\b|\bnext\b.*\bbuild\b/i;
const DAEMON_RE = /\b(dashboard|serve)\b/i;

async function agentChildren(): Promise<number> {
  let lines: string[] = [];
  if (process.platform === "win32") {
    const ps = `Get-CimInstance Win32_Process -Filter "ParentProcessId=${process.pid}" | Where-Object { $_.ProcessId -ne $PID } | ForEach-Object { [string]$_.CommandLine }`;
    const r = await run("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps], 20_000);
    lines = r.out.split(/\r?\n/);
  } else {
    const r = await run("ps", ["-ax", "-o", "ppid=,command="], 10_000);
    lines = r.out
      .split("\n")
      .map((l) => l.trim().match(/^(\d+)\s+(.*)$/))
      .filter((m): m is RegExpMatchArray => !!m && Number(m[1]) === process.pid)
      .map((m) => m[2]);
  }
  return lines.filter((l) => l.trim() && !/Get-CimInstance/.test(l) && AGENT_RE.test(l) && !DAEMON_RE.test(l)).length;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * What a restart would cut off right now, in words ("2 missions", "1 project-run step").
 * Empty = safe to restart. (Rule 11 in AGENTS.md: in-flight runs die with the server.)
 */
export async function updateBlockers(exceptJobId?: string): Promise<string[]> {
  const out: string[] = [];
  const host = os.hostname();
  const { listJobs } = await import("./sessionActions");
  const jobs = (await listJobs().catch(() => [])).filter((j) => j.host === host && j.id !== exceptJobId && j.mode !== "update" && j.status === "running");
  if (jobs.length) out.push(plural(jobs.length, "session run"));
  const [{ listMissions }, { listOrchestrations }, { listGoalRuns }, { listChats }] = await Promise.all([
    import("./missions"),
    import("./orchestrator"),
    import("./goalmode"),
    import("./mastermind"),
  ]);
  const missions = (await listMissions().catch(() => [])).filter((m) => m.status === "running").length;
  if (missions) out.push(plural(missions, "mission"));
  const orch = (await listOrchestrations().catch(() => [])).filter((o) => ["planning", "running", "assembling"].includes(o.status)).length;
  if (orch) out.push(plural(orch, "orchestration"));
  const goals = (await listGoalRuns().catch(() => [])).filter((g) => g.status === "running").length;
  if (goals) out.push(plural(goals, "goal-mode run"));
  const chats = (await listChats().catch(() => [])).filter((c) => c.status === "running").length;
  if (chats) out.push(plural(chats, "Mastermind chat"));
  const { runStepsInFlight } = await import("./runs");
  const steps = runStepsInFlight();
  if (steps) out.push(plural(steps, "project-run step"));
  const kids = await agentChildren().catch(() => 0);
  if (kids && !jobs.length && !missions && !orch && !goals && !chats && !steps) out.push(plural(kids, "agent process", "agent processes"));
  return out;
}

// ─── running the update ───

export interface UpdateStatus {
  jobId: string;
  by?: string;
  state: "running" | "done" | "failed";
  step: string;
  steps: string[];
  oldHead?: string;
  newHead?: string;
  note?: string;
  upToDate?: boolean;
  rolledBack?: boolean;
  startedAt?: number;
  at: number;
}

export function readUpdateStatus(): UpdateStatus | null {
  const s = readJson<UpdateStatus>(STATUS_FILE);
  if (s && !Array.isArray(s.steps)) s.steps = s.steps ? [String(s.steps)] : [];
  return s;
}

/**
 * Start the detached update script for a job. It outlives this server (it is the thing that
 * restarts it) and reports through data/update-status.json, which the next server reads.
 */
export function launchUpdate(jobId: string, by: string): void {
  const safeBy = by.replace(/[^\w .-]/g, "").slice(0, 60) || "Mission Control";
  writeJson(STATUS_FILE, { jobId, by: safeBy, state: "running", step: "starting", steps: [], startedAt: Date.now(), at: Date.now() } satisfies UpdateStatus);
  const win = process.platform === "win32";
  const script = path.join(REPO, "scripts", win ? "self-update.ps1" : "self-update.sh");
  if (!fs.existsSync(script)) throw new Error(`${path.basename(script)} is missing from this install.`);
  const child = win
    ? spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", script, "-JobId", jobId, "-By", safeBy], {
        cwd: REPO,
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        env: cleanEnv(),
      })
    : spawn("bash", [script, jobId, safeBy], { cwd: REPO, detached: true, stdio: "ignore", env: cleanEnv() });
  child.on("error", () => {});
  child.unref();
}
