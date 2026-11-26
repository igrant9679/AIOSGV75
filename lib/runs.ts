import fsp from "fs/promises";
import os from "os";
import path from "path";
import { vaultAvailable, vaultInfo, todayStamp } from "./vault";
import { abandonRemoteJob, listJobs, newJobId, startJob, type JobAccess, type SessionJob } from "./sessionActions";
import { sessionsSnapshot, type SubscriptionMeter } from "./sessions";
import { mergeRemoteSessions } from "./sessionShare";
import { readConfig } from "./cluster";
import { runAgentText } from "./runners";
import { createApproval, listApprovals } from "./approvals";
import { sendTelegram } from "./telegram";
import { readTasks, writeTasks, newTaskId } from "./tasks";
import { pickHermesModel, readWorkerModelSettings } from "./nousModels";
import { cliAvailable } from "./cliAvailable";
import { toolLabel, workerLabel, type SessionTool, type WorkerTool } from "./sessionTools";
import { readRegistry, isLocalEndpoint } from "./registry";
import { productName } from "./netSettings";
import { readChecks } from "./projectChecks";
import { placeTask, type PlacementMachine } from "./runPlacement";
import { noteAttempt, readLessons, recordText, saveLessons, workerRecord, type AttemptNote, type Outcome } from "./runLessons";
import { commitAll, finishBranch, startBranch, workingDiff, type RunGit } from "./runGit";

/**
 * Project runs — hand over a brief; it is planned into tasks, each task is done
 * by a REAL session (Claude Code, Codex or Hermes, in a folder, able to edit
 * files when allowed), reviewed, reworked or escalated, and delivered.
 * Design and build order: ROADMAP-ORCHESTRATOR.md. This file is phase 1.
 *
 * How it differs from lib/orchestrator.ts, which stays as the quick path for a
 * text deliverable:
 *
 *  - WORKERS ARE SESSIONS, started through lib/sessionActions.ts, so they have a
 *    folder and tools and keep their context: rework is a reply to the same
 *    session, not a fresh call handed its old output as text.
 *  - A RUN SURVIVES THE SERVER. State is a file in the vault
 *    (Agentic OS/Runs/<run>/run.json), advanced one step at a time by a tick.
 *    Nothing important lives only in memory: after a restart the tick reads the
 *    file and carries on. A job's id is written into the run BEFORE the job is
 *    started, so a crash between the two is recovered by looking the job up.
 *  - CHEAPEST WORKER THAT FITS. Every task has a tier; routine work goes to
 *    Hermes on a free Nous model, standard work to Codex, hard work to Claude.
 *    A task that fails review twice at one tier is retried one tier up.
 *
 * WHO ADVANCES A RUN: the machine that created it (`driver`), on its own tick —
 * not the cluster master. One writer per file, as everywhere else in the vault:
 * only the driver writes run.json; every other machine (and this machine's own
 * API routes, which are a different module instance from the tick) asks for
 * changes by dropping a file in the run's commands/ folder.
 *
 * PHASE 2 — EVIDENCE. A folder can list check commands it trusts
 * (lib/projectChecks.ts: per machine, never from the vault). A task that changes
 * files can require some of them by name; when its worker finishes, Mission
 * Control runs those commands itself, and only a task whose checks pass goes on
 * to review — with the results in front of the reviewer. A failed check goes
 * back to the worker with the end of the command's output. Checks run only when
 * the run works on the machine that drives it.
 *
 * THE LOCAL MODEL AS A WORKER. A machine with a local model (Ollama) uses it
 * first for the smallest tasks: routine, text in and text out, no web, no files.
 * It is not a session — one plain completion, no tools, nothing written to the
 * shared memory — and its work is reviewed from above like anyone's. If it is
 * not accepted the task goes to the normal ladder with all its attempts intact.
 *
 * PHASE 3 — SPREAD OVER THE MACHINES. A run started with "spread" may send an
 * answer-only task to another machine in the group when that one is less busy
 * (lib/runPlacement.ts has the rules). Tasks that edit files or must pass checks
 * stay on the run's own machine: the files are there. The run is still advanced
 * by one machine; the others only do jobs it asks for, through the same request
 * channel as any cross-machine session. A machine that does not pick a task up
 * in time is skipped for that task, and the task goes elsewhere without losing
 * an attempt.
 *
 * PHASE 4 — LESSONS. Every attempt leaves a note on its task (`history`). At
 * delivery the ones that went wrong become the run's Lessons.md and are added
 * to the project's lessons file; the next plan for that project is given them,
 * with each worker's recent record (lib/runLessons.ts).
 *
 * PHASE 5 — A BRANCH PER RUN. A run that may edit files, in a git repository
 * with nothing uncommitted, works on its own branch; each accepted task is a
 * commit, its reviewer sees the real diff, and at delivery the folder goes back
 * to the branch it was on (lib/runGit.ts). Tasks that edit files take turns in
 * the folder, so each one's changes - and its diff - are its own.
 */

export type RunStatus = "planning" | "awaiting_approval" | "running" | "paused" | "delivering" | "done" | "failed" | "stopped";
export type TaskStatus = "pending" | "running" | "checking" | "review" | "done" | "failed";

export interface CheckResult {
  name: string;
  /** false = it could not be started at all (removed from the list since planning, folder gone) */
  ran: boolean;
  ok: boolean;
  exitCode?: number;
  /** the end of the command's output, or why it could not run */
  summary: string;
  at: number;
}
export type Tier = "routine" | "standard" | "hard";
const TIERS: Tier[] = ["routine", "standard", "hard"];

export interface RunTask {
  id: string;
  title: string;
  brief: string;
  /** what the planner asked for */
  tier: Tier;
  /** what it is being worked at now — rises when a tier keeps failing */
  workTier: Tier;
  needsWeb: boolean;
  /**
   * The worker must read files in the run's folder. An answer-only task like that cannot go to the
   * local model (it gets text only) or to Hermes (at answer level it has no tool that reads files:
   * its file toolset also writes). Unset on older runs.
   */
  readsFolder?: boolean;
  access: JobAccess;
  dependsOn: string[];
  /** how a reviewer will know it is done right */
  accept: string;
  status: TaskStatus;
  /** finished attempts, across all tiers */
  attempts: number;
  attemptsAtTier: number;
  tool?: WorkerTool;
  model?: string;
  /** why this worker was chosen */
  why?: string;
  /** tool "local": the id of this machine's local model in data/registry.json */
  agent?: string;
  /** the local model's call in flight. It is not a job: nothing to look up, so after a restart it is simply made again */
  local?: { at: number };
  /** the local model has had its one go at this task */
  triedLocal?: boolean;
  /** where the current worker runs. Unset on runs from before tasks could move: the run's own machine */
  host?: string;
  hostLabel?: string;
  /** the folder it works in there ("~" = home folder) */
  folder?: string;
  /** machines that did not pick this task up in time; it is not sent to them again */
  avoid?: string[];
  /** one note per attempt: who, at what tier, where, how it ended (lessons and the record are made from these) */
  history?: AttemptNote[];
  /** edit tasks on a run with a branch: what changed on disk, as git saw it when the task went to review */
  diff?: string;
  /** the job in flight; written before the job is started */
  job?: { id: string; mode: "new" | "reply"; at: number };
  jobIds: string[];
  /** names of this folder's check commands the task must pass (only for tasks that edit files) */
  checks?: string[];
  /** results for the CURRENT attempt; cleared when the worker goes again */
  checkResults?: CheckResult[];
  /** the check in flight; written before its job is started, like `job` */
  checkJob?: { id: string; name: string; at: number };
  /** the worker's session — rework replies go here */
  sessionKey?: string;
  /** times a worker stopped for time was told to carry on in its own session (not failures; at most MAX_CONTINUE) */
  continued?: number;
  /** the next start is a continuation in `sessionKey`, not a rework */
  continueNext?: boolean;
  result?: string;
  /** what the reviewer wants changed (drives the next attempt) */
  feedback?: string;
  reviewedBy?: string;
  reviewTries?: number;
  /** set when a task is accepted without a real review, so the delivery can say so */
  reviewNote?: string;
  error?: string;
  startedAt?: number;
  finishedAt?: number;
}

export interface Run {
  v: 1;
  /** also the folder name under Agentic OS/Runs */
  id: string;
  title: string;
  brief: string;
  /** the machine that advances this run */
  driver: string;
  driverLabel: string;
  /** where the tasks run */
  host: string;
  hostLabel: string;
  folder: string;
  project?: string;
  planner: "auto" | "claude" | "hermes" | "codex";
  /** tasks may edit files in the folder; off = every task is answer-only */
  allowEdit: boolean;
  /** answer-only tasks may run on other machines in the group (phase 3). Unset on older runs = all on `host` */
  spread?: boolean;
  /** work on a git branch of its own when the folder allows it (phase 5) */
  branch?: boolean;
  /** the branch, once made */
  git?: RunGit;
  /** why there is no branch, or where the work ended up */
  gitNote?: string;
  /** check names this folder offered when the run was created (the commands stay on the machine) */
  checks?: string[];
  status: RunStatus;
  pausedFrom?: RunStatus;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  finishedAt?: number;
  tasks: RunTask[];
  caps: { maxTasks: number; maxAttempts: number };
  approvalId?: string;
  planNote?: string;
  error?: string;
  boardTaskId?: string;
  delivery?: string;
}

const MAX_BRIEF = 8000;
/** What is kept of a worker's reply. Generous on purpose: everything downstream reads this copy. */
const MAX_RESULT = 30_000;
/**
 * How much of an earlier task's result a later worker is given. The first real run cut this at
 * 3,000 characters (and the reviewer's copy at 7,000): the reviewer saw "…(shortened)", took the
 * worker for having truncated its own answer, and rejected good work. Whoever judges or builds on
 * a result has to see all of it — or be told plainly that the cut is ours.
 */
const DEP_RESULT = 10_000;
/**
 * How long a job sent to another machine may wait there without starting before the task is
 * taken back and placed elsewhere (no attempt is used: the worker never saw it). Through OneDrive
 * each hop takes one to four minutes, so the vault gets longer.
 */
const PICKUP_PATIENCE_MS = { lan: 4 * 60_000, vault: 12 * 60_000 };
/** Tool-calling rounds a Hermes worker may take, by tier, and how long any worker may run. */
const HERMES_TURNS: Record<Tier, number> = { routine: 20, standard: 35, hard: 50 };
const TIME_BUDGET_MS: Record<Tier, number> = { routine: 8 * 60_000, standard: 15 * 60_000, hard: 19 * 60_000 };
/**
 * A Claude worker on standard or hard work that runs out of time is not failed at once: it is
 * stopped (its session, and any files it changed, are kept) and told to carry on in the same
 * session, up to this many times. That is how a task outlasts the 20-minute job limit. A routine
 * worker that runs out of time has gone wrong, not run long: it fails as before (rule 19).
 */
const MAX_CONTINUE = 2;
const DEFAULT_CAPS = { maxTasks: 8, maxAttempts: 4 };
const ACTIVE: RunStatus[] = ["planning", "awaiting_approval", "running", "delivering"];
const RUN_ID_RE = /^\d{4}-\d{2}-\d{2} [a-z0-9-]{1,48} [a-z0-9]{4}$/;

const me = () => os.hostname();
const runsDir = () => path.join(vaultInfo().base, "Runs");
const dirOf = (id: string) => path.join(runsDir(), id);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n).trimEnd()}\n…(shortened)` : s);

// ─── storage ───

export async function readRun(id: string): Promise<Run | null> {
  if (!RUN_ID_RE.test(id)) return null;
  try {
    const run = JSON.parse(await fsp.readFile(path.join(dirOf(id), "run.json"), "utf8")) as Run;
    return run?.v === 1 && run.id === id && Array.isArray(run.tasks) ? run : null;
  } catch {
    return null;
  }
}

const STATUS_WORD: Record<RunStatus, string> = {
  planning: "Planning",
  awaiting_approval: "Waiting for you to approve the plan",
  running: "Running",
  paused: "Paused",
  delivering: "Writing the delivery",
  done: "Done",
  failed: "Failed",
  stopped: "Stopped",
};

/** A task whose worker runs on another machine than the run's own. */
const elsewhere = (run: Run, t: RunTask) => !!t.host && t.host !== run.host;

/** The human-readable twin of run.json, for Obsidian. */
function runMarkdown(run: Run): string {
  const mark = (t: RunTask) => (t.status === "done" ? "x" : " ");
  const state = (t: RunTask) =>
    t.status === "done" ? (t.reviewNote ? `done, ${t.reviewNote}` : "done") : t.status === "failed" ? `FAILED: ${(t.error ?? "").slice(0, 160)}` : t.status === "review" ? "in review" : t.status === "checking" ? "running its checks" : t.status;
  return [
    `# ${run.title}`,
    ``,
    `#agentic-os/run · [[Agentic OS/Home|Agentic OS]]`,
    ``,
    `> A project run by ${productName()}. This note is rewritten as the run moves; the state itself is run.json beside it.`,
    ``,
    `- **Status:** ${STATUS_WORD[run.status]}${run.error ? ` — ${run.error}` : ""}`,
    `- **Runs on:** ${run.hostLabel} · ${run.folder === "~" ? "home folder" : run.folder}${run.allowEdit ? " · tasks may edit files" : " · answer-only"}${run.spread ? " · answer-only tasks may go to other machines" : ""}`,
    `- **Advanced by:** ${run.driverLabel} · planner: ${run.planner}`,
    ...(run.git ? [`- **Branch:** ${run.git.branch} (from ${run.git.base})${run.git.returned ? " · the folder is back on " + run.git.base : ""}`] : run.gitNote ? [`- **Branch:** none - ${run.gitNote}`] : []),
    `- **Started:** ${new Date(run.createdAt).toLocaleString()}${run.finishedAt ? ` · finished ${new Date(run.finishedAt).toLocaleString()}` : ""}`,
    ``,
    `## Brief`,
    ``,
    run.brief,
    ``,
    `## Plan`,
    ``,
    ...(run.tasks.length === 0 ? ["_Not planned yet._"] : []),
    ...run.tasks.map(
      (t) =>
        `- [${mark(t)}] **${t.id} · ${t.title}** — ${t.tier}${t.workTier !== t.tier ? ` → ${t.workTier}` : ""}${t.needsWeb ? " · web" : ""} · ${t.access}${t.dependsOn.length ? ` · after ${t.dependsOn.join(", ")}` : ""}${t.checks?.length ? ` · must pass ${t.checks.join(", ")}` : ""}${t.tool ? ` · ${workerLabel(t.tool)}${t.model ? ` (${t.model})` : ""}` : ""}${elsewhere(run, t) ? ` on ${t.hostLabel}` : ""} · ${state(t)}`,
    ),
    ...(run.planNote ? [``, `_${run.planNote}_`] : []),
    ``,
  ].join("\n");
}

/**
 * Replace a file that something else may be holding. The vault is a OneDrive
 * folder: while OneDrive uploads run.json (or Obsidian or antivirus reads it),
 * Windows refuses the rename with EPERM/EBUSY for a moment. That threw away a
 * whole step once. Wait and try again; as a last resort write in place.
 */
async function replaceFile(file: string, content: string): Promise<void> {
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, content, "utf8");
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      await fsp.rename(tmp, file);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES") throw e;
      await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
    }
  }
  await fsp.writeFile(file, content, "utf8");
  await fsp.unlink(tmp).catch(() => {});
}

async function writeRun(run: Run): Promise<void> {
  const dir = dirOf(run.id);
  await fsp.mkdir(dir, { recursive: true });
  await replaceFile(path.join(dir, "run.json"), JSON.stringify(run, null, 1));
  const md = runMarkdown(run);
  const mdFile = path.join(dir, "Run.md");
  if ((await fsp.readFile(mdFile, "utf8").catch(() => null)) !== md) await fsp.writeFile(mdFile, md, "utf8").catch(() => {});
}

async function log(id: string, line: string): Promise<void> {
  const stamp = new Date().toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  await fsp.appendFile(path.join(dirOf(id), "Log.md"), `- ${stamp} · ${line.replace(/\s+/g, " ").slice(0, 400)}\n`, "utf8").catch(() => {});
}

async function writeTaskNote(run: Run, t: RunTask): Promise<void> {
  const dir = path.join(dirOf(run.id), "tasks");
  await fsp.mkdir(dir, { recursive: true }).catch(() => {});
  const md = [
    `# ${t.id} · ${t.title}`,
    ``,
    `Part of [[Agentic OS/Runs/${run.id}/Run|${run.title}]] · ${t.status}${t.reviewNote ? ` (${t.reviewNote})` : ""} · ${t.attempts} attempt${t.attempts === 1 ? "" : "s"}${t.tool ? ` · ${workerLabel(t.tool)}${t.model ? ` on ${t.model}` : ""}` : ""}${t.hostLabel ? ` · ran on ${t.hostLabel}` : ""}`,
    ``,
    `## Task`,
    ``,
    t.brief,
    ``,
    `**Done means:** ${t.accept}`,
    ``,
    `## Result`,
    ``,
    t.result?.trim() || (t.error ? `_Failed: ${t.error}_` : "_No result._"),
    ...((t.checkResults ?? []).length
      ? [``, `## Checks run by ${productName()}`, ``, ...(t.checkResults ?? []).flatMap((r) => [`**${r.name}** — ${r.ran ? (r.ok ? "passed" : `FAILED (exit code ${r.exitCode ?? "?"})`) : "could not be run"}`, ``, "```", r.summary.trim() || "(no output)", "```", ``])]
      : []),
    ...(t.diff ? [``, `## What changed on disk (git)`, ``, "```diff", t.diff, "```"] : []),
    ...(t.feedback ? [``, `## Last review`, ``, t.feedback] : []),
    ``,
  ].join("\n");
  await fsp.writeFile(path.join(dir, `${t.id}.md`), md, "utf8").catch(() => {});
}

export async function listRuns(limit = 60): Promise<Run[]> {
  if (!(await vaultAvailable())) return [];
  const names = (await fsp.readdir(runsDir()).catch(() => [] as string[])).filter((n) => RUN_ID_RE.test(n));
  names.sort().reverse();
  const out: Run[] = [];
  for (const n of names.slice(0, limit)) {
    const r = await readRun(n);
    if (r) out.push(r);
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

/** Serialise every change to one run within this process: read, change, write. */
const locks = new Map<string, Promise<unknown>>();
function withRun<T>(id: string, fn: (run: Run) => T | Promise<T>): Promise<T | null> {
  const prev = locks.get(id) ?? Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(async () => {
      const run = await readRun(id);
      if (!run) return null;
      const before = JSON.stringify(run);
      const out = await fn(run);
      if (JSON.stringify(run) !== before) {
        run.updatedAt = Date.now();
        await writeRun(run);
      }
      return out;
    });
  locks.set(id, next);
  return next;
}

// ─── creating and commanding (any machine, any module instance) ───

export interface CreateInput {
  brief: string;
  title?: string;
  host?: string;
  folder?: string;
  project?: string;
  planner?: string;
  allowEdit?: boolean;
  spread?: boolean;
  branch?: boolean;
}

export async function createRun(input: CreateInput): Promise<Run> {
  if (!(await vaultAvailable())) throw new Error("The vault isn't reachable, and runs live in it.");
  const brief = (input.brief ?? "").trim();
  if (brief.length < 12) throw new Error("Describe what you want done first.");
  if (brief.length > MAX_BRIEF) throw new Error(`That brief is too long (max ${MAX_BRIEF.toLocaleString()} characters).`);

  const snap = await sessionsSnapshot();
  const { sessions, remote } = await mergeRemoteSessions(snap.sessions);
  const cfg = await readConfig().catch(() => null);
  const myLabel = cfg?.label || me();
  const host = input.host || me();
  const folder = input.folder || "~";
  const allowEdit = input.allowEdit === true;
  // the same rule as starting a session by hand: only a folder that machine's sessions already use
  if (folder !== "~" && !sessions.some((s) => s.host === host && (s.folder === folder || s.cwd === folder))) {
    throw new Error("Pick a project that has a folder on that machine, or use its home folder.");
  }
  let hostLabel = myLabel;
  if (host !== me()) {
    const m = remote.find((r) => r.host === host);
    if (!m) throw new Error("That machine isn't sharing with this one.");
    hostLabel = m.label;
    if (m.acceptsReplies === "off") throw new Error(`${m.label} doesn't accept work from other machines (Fleet → Sharing there).`);
    if (allowEdit && m.acceptsReplies !== "edit") throw new Error(`${m.label} only allows answers from other machines, so tasks there can't edit files.`);
  }

  // Checks are evidence about files, run by this machine: only when tasks may edit, and the run works here.
  const checks = allowEdit && host === me() && folder !== "~" ? (await readChecks(folder)).map((c) => c.name) : [];
  const title = (input.title?.trim() || brief.split(/\r?\n/)[0]).replace(/\s+/g, " ").slice(0, 90);
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 44) || "run";
  const id = `${todayStamp()} ${slug} ${Math.random().toString(36).slice(2, 6).padEnd(4, "0")}`;
  const planner = (["auto", "claude", "hermes", "codex"] as const).find((p) => p === input.planner) ?? "auto";
  const run: Run = {
    v: 1,
    id,
    title,
    brief,
    driver: me(),
    driverLabel: myLabel,
    host,
    hostLabel,
    folder,
    project: input.project?.slice(0, 80),
    planner,
    allowEdit,
    spread: input.spread === true,
    // a branch is made on this machine, in a real folder, for a run whose tasks may edit files
    branch: allowEdit && host === me() && folder !== "~" && input.branch !== false,
    checks,
    status: "planning",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    tasks: [],
    caps: { ...DEFAULT_CAPS },
  };
  await writeRun(run); // the folder is new, so there is no other writer yet
  await log(id, `Run created on ${myLabel}; tasks will run on ${hostLabel} in ${folder === "~" ? "its home folder" : folder}${run.spread ? ", and answer-only tasks may go to other machines when that one is busy" : ""}.`);
  return run;
}

export type RunCommand = "pause" | "resume" | "stop";

/** Ask the driver to change a run. Works from any machine: the file travels with the vault. */
export async function commandRun(id: string, action: RunCommand, by: string): Promise<void> {
  const run = await readRun(id);
  if (!run) throw new Error("That run isn't in the vault.");
  const dir = path.join(dirOf(id), "commands");
  await fsp.mkdir(dir, { recursive: true });
  const name = `${Date.now()}-${me().replace(/[^\w-]+/g, "_")}-${Math.random().toString(36).slice(2, 6)}.json`;
  await fsp.writeFile(path.join(dir, name), JSON.stringify({ action, by: by.slice(0, 40), at: Date.now() }), "utf8");
}

// ─── prompts ───

function extractJson<T>(text: string): T | null {
  const cleaned = text.replace(/```(?:json)?/gi, "");
  const match = cleaned.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as T;
  } catch {
    return null;
  }
}

function planPrompt(run: Run, past: { lessons: string; record: string } = { lessons: "", record: "" }): string {
  return [
    `You are planning a project for a team of AI workers run by ${productName()}. Break the brief into tasks.`,
    ``,
    `BRIEF:`,
    run.brief,
    ``,
    `WORKING FOLDER: ${run.folder === "~" ? "the home folder" : run.folder} on ${run.hostLabel}. ${run.allowEdit ? "Workers MAY create and change files there." : "Workers may NOT change files: every task must deliver its result as text."}`,
    ``,
    `Rules:`,
    `- 1 to ${run.caps.maxTasks} tasks. Fewer is better. A task is something one worker can finish in one sitting.`,
    `- A task may depend on earlier tasks ("dependsOn": their ids). A dependent task's worker is given those results.`,
    `- Each brief must be self-contained: the worker sees the project brief, its own task and the results it depends on. Nothing else.`,
    `- "tier" — choose the LOWEST that will do the task well; routine work runs on a free model:`,
    `    "routine"  look something up, summarise, classify, draft, reformat, a simple edit`,
    `    "standard" a contained change, analysing several files, careful writing`,
    `    "hard"     design, reasoning across many parts, debugging, anything where a wrong answer is expensive`,
    `- "needsWeb": true only if the task needs current information from the internet.`,
    ...(run.folder !== "~"
      ? [`- "readsFolder": true if the worker has to read files in the working folder to do the task (anything about the project's own code or documents); false if the brief and the results it depends on are enough. The cheapest workers cannot read files, so be accurate.`]
      : []),
    `- "access": "answer" (read and reply only) or "edit" (may change files in the working folder).${run.allowEdit ? ' Use "edit" only when the task must create or change files.' : ' Use "answer" for every task.'}`,
    `- "accept": one or two sentences — how a reviewer will know the task was done right.`,
    ...((run.checks ?? []).length
      ? [
          `- "checks": names from this list that the task's work must pass: ${(run.checks ?? []).join(", ")}. ${productName()} runs them itself in the folder after the worker finishes, so a task that changes code should name the ones that prove it works. Only for "edit" tasks; leave it [] otherwise. Do not invent names.`,
        ]
      : []),
    ``,
    ...(past.lessons
      ? [
          ``,
          `WHAT EARLIER RUNS ON THIS PROJECT RAN INTO (use it to choose tiers and write clearer briefs and "accept" lines; do not repeat it back):`,
          past.lessons,
        ]
      : []),
    ...(past.record ? [``, `HOW WORKERS HAVE DONE RECENTLY (attempts that passed review, by tier; raise a tier where the record is poor):`, past.record] : []),
    ``,
    `Return ONLY a JSON array, nothing before or after it:`,
    `[{"id":"t1","title":"short name","brief":"the full instruction","tier":"routine","needsWeb":false,${run.folder !== "~" ? `"readsFolder":true,` : ""}"access":"answer","dependsOn":[],"accept":"…"${(run.checks ?? []).length ? `,"checks":[]` : ""}}]`,
  ].join("\n");
}

function workPrompt(run: Run, t: RunTask, opts: { local?: boolean } = {}): string {
  const deps = t.dependsOn.map((id) => run.tasks.find((x) => x.id === id)).filter((x): x is RunTask => !!x && !!x.result);
  return [
    `You are doing ONE task of a larger project run by ${productName()}.`,
    ``,
    `PROJECT: ${run.title}`,
    clip(run.brief, 1500),
    ``,
    `YOUR TASK (${t.id}): ${t.title}`,
    t.brief,
    ``,
    `DONE MEANS: ${t.accept}`,
    ...(deps.length ? [``, `RESULTS OF THE TASKS THIS ONE DEPENDS ON:`, ...deps.map((d) => `--- ${d.id}: ${d.title} ---\n${clip(d.result ?? "", DEP_RESULT)}`)] : []),
    // a fresh worker picking up after others failed gets what they produced and why it was rejected
    ...(t.feedback && t.result ? [``, `AN EARLIER ATTEMPT WAS REJECTED. Its output:`, clip(t.result, 2500), ``, `The reviewer said: ${t.feedback}`] : []),
    ``,
    `Rules:`,
    `- Do this task only. Do not start on other parts of the project.`,
    t.access === "edit" ? `- You may create and change files in the working folder. Do not delete anything you did not create.` : `- You cannot change files in this session. Put everything you produce in your reply.`,
    `- If you cannot finish, start your reply with "BLOCKED:" and say exactly what stopped you. Do not pretend.`,
    ...(t.access === "edit" ? [`- Delete any scratch or probe files you create along the way. Leave only what the task asks for.`] : []),
    // A local model read "followed by what you produced" as "repeat it all" and was rejected for a duplicated answer
    opts.local
      ? `- Give your full answer once. Then end with ONE line starting "RESULT:" that says in one sentence what you produced. Do not repeat the answer after it.`
      : `- After your work, end with a separate line starting "RESULT:" that says what you produced${t.access === "edit" ? " and the paths of any files you changed" : ""}. Keep it on its own line, never inside the deliverable.`,
  ].join("\n");
}

/**
 * What a task's result is after a rework reply.
 *
 * A task that EDITS FILES: the work is on disk and the reply usually describes only the fix, so
 * keep what the worker said before it - or the next reviewer sees "I added the VERSION file" and
 * no sign of the actual task.
 *
 * An ANSWER task: the text is the deliverable and the rework prompt asks for the complete
 * corrected result, so it replaces the old one. Appending it gave the reviewer two copies of a
 * poem, which it rejected as eight lines instead of four. Only a reply far shorter than the old
 * result - a description of a fix rather than the result - is appended instead.
 */
function afterRework(t: RunTask, before: string, reply: string): string {
  const appended = `${before}\n\n--- After the review, the worker added ---\n\n${reply}`;
  if (t.access === "edit") return appended;
  return before.length > 400 && reply.length < before.length * 0.4 ? appended : reply;
}

function continuePrompt(t: RunTask, minutes: number): string {
  return [
    `You were stopped after about ${minutes} minutes on "${t.title}" because of the time limit for one sitting. Everything you did is kept${t.access === "edit" ? ", including the files you changed" : ""}.`,
    ``,
    `Carry on from where you stopped and finish the task. What "done" means: ${t.accept}`,
    ``,
    t.access === "edit"
      ? `When you finish, say what you changed. If you cannot finish, start with "BLOCKED:" and say why. End with a separate line starting "RESULT:" with what you produced and the paths of the files you changed.`
      : `When you finish, give the complete result, the whole thing once. If you cannot finish, start with "BLOCKED:" and say why. End with a separate line starting "RESULT:".`,
  ].join("\n");
}

function reworkPrompt(t: RunTask): string {
  return [
    `Your work on "${t.title}" was reviewed and is not accepted yet.`,
    ``,
    `The reviewer said: ${t.feedback}`,
    ``,
    `What "done" means: ${t.accept}`,
    ``,
    t.access === "edit"
      ? `Fix it in the files, then say what you changed. If you cannot, start with "BLOCKED:" and say why. End with a separate line starting "RESULT:".`
      : `Fix it and give the complete corrected result, the whole thing once (not a list of changes): it replaces your earlier answer. If you cannot, start with "BLOCKED:" and say why. End with a separate line starting "RESULT:".`,
  ].join("\n");
}

function reviewPrompt(run: Run, t: RunTask, diff = ""): string {
  return [
    `You are the reviewer in a team of AI workers. Be strict and specific.`,
    ``,
    `Project: ${run.title}`,
    `Task: ${t.title}`,
    `What the worker was told:`,
    clip(t.brief, 2500),
    ``,
    `What "done" means: ${t.accept}`,
    ...((t.checkResults ?? []).length
      ? [
          ``,
          `Checks ${productName()} ran ITSELF in the project folder after this work. This is evidence, not the worker's claim:`,
          ...(t.checkResults ?? []).map((r) => `- ${r.name}: ${r.ran ? (r.ok ? "PASSED (exit code 0)" : "FAILED") : `could NOT be run (${r.summary.slice(0, 160)}) - treat what it would have shown as unproven`}`),
        ]
      : []),
    ``,
    ...(diff ? [``, `WHAT CHANGED ON DISK during this task, measured by ${productName()} with git (evidence, not the worker's description):`, "```diff", diff, "```"] : []),
    ``,
    `The worker's output${(t.result ?? "").length >= MAX_RESULT ? ` (the system kept only the first ${MAX_RESULT.toLocaleString()} characters; a cut at the very end is ours, not the worker's)` : ""}:`,
    `---`,
    t.result ?? "",
    `---`,
    ``,
    `The worker was told to end with a line starting "RESULT:" that sums up what it produced. That line is the system's marker, not part of the deliverable: never reject the work because of it, and if part of the deliverable sits on that line, read it as the deliverable.`,
    `Judge the output against what "done" means and what the worker was told - nothing else. Do not reject it for failing a standard nobody set, and do not ask for polish beyond what the task needs: a rejection costs a whole new attempt.`,
    ...(t.access === "edit" && run.host === me() && run.folder !== "~"
      ? [`You are in the project's folder. READ the files this task was meant to change and judge what is actually on disk, not the worker's description of it. You cannot run commands or change files, and do not need to: any check listed above was already run for you.`]
      : [`Judge only what is in front of you. If the output claims something happened (a file written, a test passed) that you cannot see evidence of, say so in the feedback rather than taking it on trust.`]),
    `Return ONLY JSON: {"pass": true} or {"pass": false, "feedback": "what is wrong and exactly what to change"}`,
  ].join("\n");
}

function deliverPrompt(run: Run): string {
  // the assembler is told how each piece was checked; left out, it reported reviewed work as unreviewed
  const checked = (t: RunTask) => {
    const results = t.checkResults ?? [];
    const ran = results.length ? `checks run by the system: ${results.map((r) => `${r.name} ${r.ran ? (r.ok ? "passed" : "failed") : "could not be run"}`).join(", ")}; ` : "";
    return `${ran}${t.reviewNote ? t.reviewNote : t.reviewedBy ? `reviewed and accepted by ${t.reviewedBy} after ${t.attempts + 1} attempt${t.attempts ? "s" : ""}` : "not reviewed"}`;
  };
  const parts = run.tasks.map((t) => `--- ${t.id}: ${t.title} (${t.status === "done" ? checked(t) : "FAILED"}) ---\n${t.status === "done" ? clip(t.result ?? "", DEP_RESULT) : `FAILED: ${t.error ?? "no result"}`}`);
  return [
    `You are assembling the final delivery of a project for its owner.`,
    ``,
    `What they asked for:`,
    run.brief,
    ``,
    `What the workers produced:`,
    ``,
    parts.join("\n\n"),
    ``,
    `Write the delivery: the result itself first, merged and ordered so it reads as one piece. Keep to any length or format limit in what they asked for.`,
    `Then a short "Status" section. State how each task was checked using ONLY the labels above (a task marked "reviewed and accepted by …" WAS reviewed: by a second model reading the output, not by running anything). Say which tasks failed or were not reviewed, what you changed while assembling, and what is still open. Do not invent results for tasks that failed. Output only the delivery.`,
  ].join("\n");
}

// ─── choosing a worker ───

function raise(tier: Tier): Tier | null {
  const i = TIERS.indexOf(tier);
  return i < TIERS.length - 1 ? TIERS[i + 1] : null;
}

interface Worker {
  tool: WorkerTool;
  model?: string;
  web?: boolean;
  /** tool "local": which registry entry */
  agent?: string;
  why: string;
  host: string;
  hostLabel: string;
  folder: string;
}

interface LocalModel {
  id: string;
  name: string;
  model: string;
}

/**
 * What the local model is trusted with: the smallest kind of task, once.
 * Text in, text out — it gets no folder, no tools and no web. The prompt has to
 * be short because Ollama sizes a model's context from the machine's memory (as
 * little as 4k tokens) and cuts a longer prompt without saying so; a worker that
 * silently lost half its instructions is worse than no worker (AGENTS.md rule 18).
 */
const LOCAL_PROMPT_MAX = 6000;
function fitsLocal(run: Run, t: RunTask): boolean {
  return t.workTier === "routine" && t.access === "answer" && !t.needsWeb && !t.readsFolder && !t.triedLocal && t.attempts === 0 && !(t.checks ?? []).length && workPrompt(run, t, { local: true }).length <= LOCAL_PROMPT_MAX;
}

/**
 * This machine's local model, if a run may use it right now: the run works on
 * this machine, the owner has not switched it off ("local": false in
 * data/worker-models.json), a keyless local endpoint is registered, and it
 * answers with that model in its list. Asked, not assumed — with Ollama closed
 * every routine task would otherwise lose a pass finding that out.
 */
async function localWorker(run: Run): Promise<LocalModel | null> {
  // the local model is THIS machine's; a task it does needs no folder, so a spreading run may use it wherever it works
  if (run.host !== me() && !run.spread) return null;
  if ((await readWorkerModelSettings()).local === false) return null;
  const llm = (await readRegistry()).llms.find((l) => isLocalEndpoint(l.baseUrl) && !l.apiKey && l.model);
  if (!llm) return null;
  try {
    const res = await fetch(`${llm.baseUrl.replace(/\/+$/, "")}/models`, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return null;
    const ids = (((await res.json()) as { data?: { id?: string }[] }).data ?? []).map((m) => String(m.id ?? ""));
    const bare = (s: string) => s.replace(/:latest$/, "");
    if (!ids.some((x) => bare(x) === bare(llm.model))) return null;
  } catch {
    return null;
  }
  return { id: llm.id, name: llm.name, model: llm.model };
}

/** One request at a time to the local model, across every run: a second would only queue inside Ollama with its time limit already running. */
let localTurn: Promise<unknown> = Promise.resolve();
function inLocalTurn<T>(work: () => Promise<T>): Promise<T> {
  const next = localTurn.catch(() => {}).then(work);
  localTurn = next;
  return next;
}

/**
 * The cheapest worker that fits the task, and where it runs.
 *   routine  → the local model for a small text-only task, if this machine has one;
 *              then Hermes on a free Nous model, then Codex, then Claude
 *   standard → Codex, then Claude
 *   hard     → Claude, then Codex
 * A tool whose subscription has hit its limit is skipped; a tool no eligible
 * machine has is skipped. On a spreading run the machine is chosen too
 * (lib/runPlacement.ts); otherwise it is the run's own. Claude on the run's
 * machine is the last resort, as before machines could be chosen.
 */
async function chooseWorker(run: Run, t: RunTask, machines: PlacementMachine[], local: LocalModel | null): Promise<Worker> {
  if (local && fitsLocal(run, t)) {
    return { tool: "local", agent: local.id, model: local.model, host: me(), hostLabel: run.driverLabel, folder: "~", why: `routine text-only task → the local model on ${run.driverLabel} (${local.model}: free, uses no subscription, nothing leaves the PC)` };
  }
  // Hermes answer-only cannot read files (its file toolset also writes), so a task that must read the folder skips it
  const hermesBlind = t.access === "answer" && !!t.readsFolder;
  const order: SessionTool[] = t.workTier === "routine" ? (hermesBlind ? ["codex", "claude"] : ["hermes", "codex", "claude"]) : t.workTier === "standard" ? ["codex", "claude"] : ["claude", "codex"];
  const pinned = !run.spread || t.access === "edit" || (t.checks ?? []).length > 0;
  const place = placeTask(machines, { tools: order, pinned, avoid: t.avoid }) ?? { tool: "claude" as SessionTool, host: run.host, label: run.hostLabel, folder: run.folder, home: true, why: "on the run's machine", skipped: order.filter((x) => x !== "claude") };
  const tool = place.tool;
  const where = { host: place.host, hostLabel: place.label, folder: place.folder };
  const note = place.skipped.length ? ` (${place.skipped.map(toolLabel).join(", ")} not available${run.spread ? "" : " there"})` : "";
  const at = run.spread ? `, ${place.why}` : "";

  if (tool === "hermes") {
    const pick = await pickHermesModel({ needsWeb: t.needsWeb });
    // each retry at this tier moves one model down the list: free tiers are rate-limited
    const model = t.attemptsAtTier > 0 ? (pick.fallbacks[t.attemptsAtTier - 1] ?? pick.model) : pick.model;
    return { tool, model, web: t.needsWeb, ...where, why: `${t.workTier} task → Hermes, ${model === pick.model ? pick.why : "next-cheapest model after a failed attempt"}${t.needsWeb ? "" : ", no web access needed"}${at}` };
  }
  if (tool === "claude") {
    // within the Claude plan too, the small model for small work: it spends far less of the quota
    const model = t.workTier === "routine" ? "haiku" : t.workTier === "standard" ? "sonnet" : undefined;
    return { tool, model, ...where, why: `${t.workTier} task → Claude${model ? ` (${model})` : ""}${note}${at}` };
  }
  return { tool, ...where, why: `${t.workTier} task → ${toolLabel(tool)} on its subscription${hermesBlind && t.workTier === "routine" ? " (it has to read the folder, which Hermes can't do in answer-only mode)" : ""}${note}${at}` };
}

type SessionLite = { host: string; status: string; project?: string; folder?: string; cwd: string; updatedAt: number };
type RemoteLite = { host: string; label: string; stale: boolean; via: "lan" | "vault"; acceptsReplies: "off" | "answer" | "edit"; runWorker?: number; subscriptions: SubscriptionMeter[] };

/**
 * The facts placement needs about every machine, from data the step has already read.
 * "Busy" is the larger of what that machine reports running and the jobs this machine has
 * in flight there (a job's session shows up in both, so adding them would count it twice).
 */
function placementMachines(run: Run, mySubs: SubscriptionMeter[], sessions: SessionLite[], remote: RemoteLite[], jobs: SessionJob[]): PlacementMachine[] {
  const busyOn = (host: string) =>
    Math.max(
      sessions.filter((s) => s.host === host && (s.status === "running" || s.status === "waiting")).length,
      jobs.filter((j) => j.host === host && (j.status === "queued" || j.status === "sent" || j.status === "running") && (j.mode === "new" || j.mode === "reply")).length,
    );
  const folderOn = (host: string): string | undefined => {
    if (host === run.host) return run.folder;
    if (run.folder === "~") return "~";
    if (!run.project) return undefined;
    const s = sessions.filter((x) => x.host === host && x.project === run.project && (x.folder || x.cwd)).sort((a, b) => b.updatedAt - a.updatedAt)[0];
    return s ? s.folder || s.cwd : undefined;
  };
  return [
    { host: me(), label: run.driverLabel, home: run.host === me(), online: true, via: "self", accepts: "edit", runWorker: true, subs: mySubs, busy: busyOn(me()), folder: folderOn(me()) },
    ...remote.map(
      (m): PlacementMachine => ({
        host: m.host,
        label: m.label,
        home: m.host === run.host,
        online: !m.stale,
        via: m.via,
        accepts: m.acceptsReplies,
        runWorker: (m.runWorker ?? 0) >= 1,
        subs: m.subscriptions,
        busy: busyOn(m.host),
        folder: folderOn(m.host),
      }),
    ),
  ];
}

/** Review from above: a routine task is checked by a subscription tool, everything else by Claude. */
function reviewerFor(t: RunTask): { agent: string; name: string } {
  if (t.workTier === "routine" && cliAvailable("codex")) return { agent: "codex-cli", name: "Codex" };
  return { agent: "claude", name: "Claude" };
}

const PLANNER_AGENT: Record<Run["planner"], string> = { auto: "claude", claude: "claude", hermes: "hermes-free", codex: "codex-cli" };

// ─── the board ───

async function boardAdd(title: string): Promise<string | undefined> {
  try {
    const { tasks, preamble } = await readTasks();
    const task = { id: newTaskId(), title: `🧭 ${title.slice(0, 160)}`, status: "in_progress" as const, createdAt: Date.now(), updatedAt: Date.now() };
    tasks.unshift(task);
    await writeTasks(tasks, preamble);
    return task.id;
  } catch {
    return undefined;
  }
}

async function boardFinish(taskId: string | undefined, ok: boolean): Promise<void> {
  if (!taskId) return;
  try {
    const { tasks, preamble } = await readTasks();
    const task = tasks.find((x) => x.id === taskId);
    if (!task) return;
    task.status = ok ? "done" : "pending"; // a failed run goes back to Pending for a human look
    task.updatedAt = Date.now();
    await writeTasks(tasks, preamble);
  } catch {
    /* board unavailable - not fatal */
  }
}

// ─── the steps ───

/** Long calls (plan, review, deliver) run outside the lock; this stops the tick starting one twice. */
const working = new Set<string>();
function detach(key: string, work: () => Promise<void>): void {
  if (working.has(key)) return;
  working.add(key);
  void work()
    .catch((e: Error) => console.error(`[mission-control] run step ${key} failed: ${e.message}`))
    .finally(() => working.delete(key));
}

async function plan(id: string): Promise<void> {
  const run = await readRun(id);
  if (!run || run.status !== "planning") return;
  let agent = PLANNER_AGENT[run.planner];
  // In the project's folder and read-only: the planner can look at what is there before it plans,
  // and cannot change anything or stall on a permission prompt. (Local runs with a real folder only.)
  const look = { cwd: run.host === me() && run.folder !== "~" ? run.folder : undefined, readOnly: true, noMcp: true };
  const past = { lessons: await readLessons(run).catch(() => ""), record: recordText(workerRecord(await listRuns(40).catch(() => []))) };
  let r = await runAgentText(agent, planPrompt(run, past), { injectMemory: true, ...look });
  let note: string | undefined;
  if (r.error && agent !== "claude") {
    note = `The ${run.planner} planner failed (${r.error.slice(0, 120)}); Claude planned instead.`;
    agent = "claude";
    r = await runAgentText(agent, planPrompt(run, past), { injectMemory: true, ...look });
  }
  if (r.error) {
    await withRun(id, (x) => {
      if (x.status !== "planning") return;
      x.status = "failed";
      x.error = `Planning failed: ${r.error!.slice(0, 300)}`;
      x.finishedAt = Date.now();
    });
    await log(id, `Planning failed: ${r.error}`);
    return;
  }

  type Raw = { id?: unknown; title?: unknown; brief?: unknown; tier?: unknown; needsWeb?: unknown; readsFolder?: unknown; access?: unknown; dependsOn?: unknown; accept?: unknown; checks?: unknown };
  let raw = extractJson<Raw[]>(r.text);
  if (!Array.isArray(raw) || raw.length === 0) {
    note = `${note ? `${note} ` : ""}The planner returned no usable plan, so the brief runs as a single task.`;
    raw = [{ title: run.title, brief: run.brief, tier: "standard", accept: "The brief is fully answered." }];
  }
  const tasks: RunTask[] = [];
  const idMap = new Map<string, string>();
  for (const x of raw.slice(0, run.caps.maxTasks)) {
    const brief = String(x.brief ?? "").trim();
    if (!brief) continue;
    const id2 = `t${tasks.length + 1}`;
    if (typeof x.id === "string") idMap.set(x.id, id2);
    const tier = TIERS.find((t) => t === x.tier) ?? "standard";
    tasks.push({
      id: id2,
      title: String(x.title ?? `Task ${tasks.length + 1}`).replace(/\s+/g, " ").slice(0, 90),
      brief: brief.slice(0, 6000),
      tier,
      workTier: tier,
      needsWeb: x.needsWeb === true,
      // in a real folder, unless the planner says the brief is enough: a wrong "false" sends the task to a worker that cannot see the files
      readsFolder: run.folder !== "~" && x.readsFolder !== false,
      access: run.allowEdit && x.access === "edit" ? "edit" : "answer",
      // only earlier tasks: a plan can't depend on itself or on something later
      dependsOn: (Array.isArray(x.dependsOn) ? x.dependsOn : []).map((d) => idMap.get(String(d))).filter((d): d is string => !!d && d !== id2),
      accept: String(x.accept ?? "The task is complete and correct.").slice(0, 600),
      status: "pending",
      attempts: 0,
      attemptsAtTier: 0,
      jobIds: [],
    });
    // only names this folder really offers, and only on a task that can change files
    const made = tasks[tasks.length - 1];
    made.checks = made.access === "edit" ? (Array.isArray(x.checks) ? x.checks : []).map(String).filter((n, i, a) => (run.checks ?? []).includes(n) && a.indexOf(n) === i) : [];
  }
  if (tasks.length === 0) {
    await withRun(id, (x) => {
      x.status = "failed";
      x.error = "The plan had no usable tasks.";
      x.finishedAt = Date.now();
    });
    return;
  }

  const summary = tasks.map((t) => `${t.id} ${t.title} [${t.tier}${t.needsWeb ? ", web" : ""}${t.access === "edit" ? ", edits files" : ""}${t.checks?.length ? `, must pass ${t.checks.join("+")}` : ""}]`).join("; ");
  const approval = await createApproval({
    payload: `Project run "${run.title}" — ${tasks.length} task${tasks.length === 1 ? "" : "s"} on ${run.hostLabel}: ${summary}`,
    source: "project run",
    handler: "run",
    notify: `🧭 Plan ready [{id}]\n\n"${run.title}" — ${tasks.length} task${tasks.length === 1 ? "" : "s"} on ${run.hostLabel}${run.allowEdit ? " (may edit files)" : ""}:\n${tasks.map((t) => `• ${t.title} (${t.tier})`).join("\n")}\n\nReply "approve {id}" or "reject {id}", or open Runs.`,
  }).catch(() => null);

  await withRun(id, (x) => {
    if (x.status !== "planning") return; // stopped while planning
    x.tasks = tasks;
    x.planNote = note;
    x.approvalId = approval?.id;
    x.status = "awaiting_approval";
  });
  await log(id, `Planned by ${agent}${past.lessons ? ", with lessons from earlier runs on this project" : ""}: ${summary}`);
}

async function checkApproval(id: string): Promise<void> {
  const run = await readRun(id);
  if (!run || run.status !== "awaiting_approval" || !run.approvalId) return;
  const a = (await listApprovals()).find((x) => x.id === run.approvalId);
  if (!a || a.status === "pending") return;
  if (a.status === "approved") {
    const board = await boardAdd(run.title);
    // the branch comes first: the first edit task must already be working on it
    const br = run.branch && run.host === me() && run.tasks.some((t) => t.access === "edit") ? await startBranch(run.folder, run.id) : null;
    await withRun(id, (x) => {
      if (x.status !== "awaiting_approval") return;
      x.status = "running";
      x.startedAt = Date.now();
      x.boardTaskId = board;
      if (br && "git" in br) x.git = br.git;
      else if (br) x.gitNote = `no branch: ${br.skip}`;
    });
    await log(id, `Plan approved by ${a.resolvedBy ?? "you"}.`);
    if (br) await log(id, "git" in br ? `Working on a new branch, ${br.git.branch} (from ${br.git.base}). Each accepted task will be a commit there.` : `No branch for this run: ${br.skip}. Tasks work in the folder as it is.`);
  } else {
    await withRun(id, (x) => {
      if (x.status !== "awaiting_approval") return;
      x.status = "stopped";
      x.error = "The plan was rejected.";
      x.finishedAt = Date.now();
    });
    await log(id, `Plan rejected by ${a.resolvedBy ?? "you"}.`);
  }
}

/** After a failed attempt: same worker again, one tier up, or give up. */
function afterFailure(run: Run, t: RunTask, reason: string, outcome: Outcome = "error"): string {
  noteAttempt(t, outcome, reason);
  if (t.tool === "local") {
    // The local model's go is free and takes seconds, so it does not use up one of the task's
    // attempts: the task goes to the normal ladder, which still has its full number of tries.
    // (`triedLocal` is what stops it coming back here; a rejected result is shown to the next worker.)
    t.local = undefined;
    t.job = undefined;
    t.tool = undefined;
    t.agent = undefined;
    t.model = undefined;
    t.host = t.hostLabel = t.folder = undefined;
    t.status = "pending";
    return `${t.id}: the local model's attempt was not accepted → handing it to a subscription worker: ${reason}`;
  }
  t.attempts++;
  t.attemptsAtTier++;
  t.job = undefined;
  t.checkJob = undefined;
  // A worker stopped for time (standard or hard Claude work) keeps its session for the next try, so
  // its progress is not thrown away. Any other failure is a rework or a fresh start, never a continuation.
  t.continueNext = outcome === "timed out" && t.tool === "claude" && t.workTier !== "routine" && !!t.sessionKey ? true : undefined;
  if (t.attempts >= run.caps.maxAttempts) {
    t.status = "failed";
    t.error = `${reason} (gave up after ${t.attempts} attempts)`.slice(0, 500);
    t.finishedAt = Date.now();
    return `${t.id} failed for good: ${reason}`;
  }
  const up = raise(t.workTier);
  if (t.attemptsAtTier >= 2 && up) {
    t.workTier = up;
    t.attemptsAtTier = 0;
    t.sessionKey = undefined; // a fresh, stronger worker; it is shown the rejected output
    t.continueNext = undefined;
    t.status = "pending";
    return `${t.id} failed twice as ${TIERS[TIERS.indexOf(up) - 1]} work → retrying as ${up}: ${reason}`;
  }
  t.status = "pending";
  return t.continueNext ? `${t.id} attempt ${t.attempts} ran out of time → continuing in the same session, counted as an attempt: ${reason}` : `${t.id} attempt ${t.attempts} failed → trying again: ${reason}`;
}

/**
 * A task done by this machine's local model: one plain completion. No session,
 * no folder, no tools — runAgentText() gives a registry model no tool loop, and
 * `injectMemory: false` keeps the shared memory out of it. What comes back is
 * treated exactly like a session's reply: empty or "BLOCKED:" is a failed go,
 * anything else goes to review.
 */
async function localWork(id: string, taskId: string): Promise<void> {
  const r = await inLocalTurn(async () => {
    // read when its turn comes, not when it was queued: the run may have been stopped while it waited
    const run = await readRun(id);
    const t = run?.tasks.find((x) => x.id === taskId);
    if (!run || run.status !== "running" || !t || t.status !== "running" || !t.local) return null;
    if (!t.agent) return { at: t.local.at, text: "", error: "no local model is recorded for this task" };
    const out = await runAgentText(t.agent, workPrompt(run, t, { local: true }), { injectMemory: false });
    return { at: t.local.at, text: (out.text ?? "").trim(), error: out.error };
  });
  if (!r) return;
  let line = "";
  await withRun(id, (run) => {
    const t = run.tasks.find((x) => x.id === taskId);
    // paused is fine (the answer is kept, like a session that finishes during a pause); stopped or moved on is not
    if (!t || t.status !== "running" || t.local?.at !== r.at || ["stopped", "failed", "done"].includes(run.status)) return;
    const model = t.model;
    t.local = undefined;
    if (r.error) line = afterFailure(run, t, `the local model could not run it: ${r.error.replace(/\s+/g, " ").slice(0, 160)}`);
    else if (!r.text) line = afterFailure(run, t, "the local model returned nothing");
    else if (/^\s*BLOCKED:/i.test(r.text)) {
      t.result = clip(r.text, MAX_RESULT);
      line = afterFailure(run, t, `the local model was blocked: ${r.text.replace(/\s+/g, " ").slice(8, 160)}`, "blocked");
    } else {
      t.result = clip(r.text, MAX_RESULT);
      t.reviewTries = 0;
      t.checkResults = [];
      t.status = "review";
      line = `${t.id} finished by the local model${model ? ` (${model})` : ""} → review.`;
    }
  });
  if (line) await log(id, line);
}

async function review(id: string, taskId: string): Promise<void> {
  const run = await readRun(id);
  const t = run?.tasks.find((x) => x.id === taskId);
  if (!run || !t || t.status !== "review") return;
  const who = reviewerFor(t);
  const diff = run.git && t.access === "edit" && run.host === me() ? await workingDiff(run.folder).catch(() => "") : "";
  if (diff) {
    await withRun(id, (x) => {
      const task = x.tasks.find((y) => y.id === taskId);
      if (task) task.diff = diff.slice(0, 4000);
    });
  }
  const r = await runAgentText(who.agent, reviewPrompt(run, t, diff), { injectMemory: false, cwd: run.host === me() && run.folder !== "~" ? run.folder : undefined, readOnly: true, noMcp: true });
  const verdict = r.error ? null : extractJson<{ pass?: boolean; feedback?: string }>(r.text);
  let line = "";
  const after = await withRun(id, (x) => {
    const task = x.tasks.find((y) => y.id === taskId);
    if (!task || task.status !== "review") return null;
    if (!verdict || typeof verdict.pass !== "boolean") {
      // The reviewer itself failed. Try once more; after that, accept — but SAY it was not reviewed.
      task.reviewTries = (task.reviewTries ?? 0) + 1;
      if (task.reviewTries < 2) return null;
      task.status = "done";
      task.reviewNote = `not reviewed (${who.name} could not review it${r.error ? `: ${r.error.slice(0, 80)}` : ""})`;
      noteAttempt(task, "unreviewed", task.reviewNote);
      task.finishedAt = Date.now();
      line = `${task.id} accepted WITHOUT a review: the reviewer failed twice.`;
      return task;
    }
    task.reviewedBy = who.name;
    if (verdict.pass) {
      noteAttempt(task, "passed", `by ${who.name}`);
      task.status = "done";
      task.feedback = undefined;
      task.finishedAt = Date.now();
      line = `${task.id} passed review by ${who.name}.`;
      return task;
    }
    task.feedback = String(verdict.feedback ?? "Not good enough yet: improve it and try again.").slice(0, 1200);
    line = afterFailure(x, task, `review by ${who.name}: ${task.feedback.slice(0, 140)}`, "rejected");
    // afterFailure() may have changed the status; TypeScript still sees the value it narrowed to above
    return (task.status as TaskStatus) === "failed" ? task : null;
  });
  if (line) await log(id, line);
  if (after) {
    await settleGit(id, taskId);
    const fresh = await readRun(id);
    if (fresh) await writeTaskNote(fresh, after);
  }
}

/**
 * An edit task on a run with a branch has settled: commit what it left in the folder - as the
 * task's commit when it was accepted, labelled "not accepted" when it failed for good, so the
 * next task starts from a clean folder and its diff is its own.
 */
async function settleGit(id: string, taskId: string): Promise<void> {
  const run = await readRun(id);
  const t = run?.tasks.find((x) => x.id === taskId);
  if (!run?.git || run.git.returned || !t || t.access !== "edit" || run.host !== me() || (t.status !== "done" && t.status !== "failed")) return;
  const accepted = t.status === "done";
  const c = await commitAll(run.folder, run.git, `${accepted ? "" : "[not accepted] "}${t.id}: ${t.title}\n\nProject run "${run.title}"${t.tool ? ` · ${workerLabel(t.tool)}` : ""}${t.reviewNote ? ` · ${t.reviewNote}` : t.reviewedBy ? ` · reviewed by ${t.reviewedBy}` : ""}`);
  if (c.sha) {
    await withRun(id, (x) => void x.git?.commits.push({ task: t.id, sha: c.sha!, accepted }));
    await log(id, `${t.id}: committed as ${c.sha} on ${run.git.branch}${accepted ? "" : " (not accepted, kept for a look)"}.`);
  } else if (c.error) await log(id, `${t.id}: ${c.error}`);
}

async function deliver(id: string): Promise<void> {
  const run = await readRun(id);
  if (!run || run.status !== "delivering") return;
  const done = run.tasks.filter((t) => t.status === "done" && t.result?.trim());
  const failed = run.tasks.filter((t) => t.status === "failed");
  let body = "";
  if (done.length === 1 && run.tasks.length === 1) body = done[0].result ?? "";
  else if (done.length > 0) {
    const r = await runAgentText("claude", deliverPrompt(run), { injectMemory: false, noMcp: true });
    // if the assembler fails, the pieces are still the delivery — stitched, and labelled as such
    body = r.error || !r.text.trim() ? `_Assembled without an editor (${(r.error ?? "no output").slice(0, 100)}); the pieces follow as the workers wrote them._\n\n${done.map((t) => `## ${t.title}\n\n${t.result}`).join("\n\n")}` : r.text;
  }
  const ok = done.length > 0;
  const unreviewed = run.tasks.filter((t) => t.reviewNote);
  const branch = run.git && !run.git.returned && run.host === me() ? await finishBranch(run.folder, run.git).catch((e: Error) => ({ note: `Could not finish the branch: ${e.message}`, returned: false })) : null;
  if (branch) {
    await withRun(id, (x) => {
      if (x.git) x.git.returned = branch.returned;
      x.gitNote = branch.note;
    });
    await log(id, branch.note);
  }
  const where = branch?.note ?? (run.git ? run.gitNote : undefined);
  const proven = run.tasks.filter((t) => t.status === "done" && (t.checkResults ?? []).some((r) => r.ran && r.ok) && (t.checkResults ?? []).every((r) => r.ran && r.ok));
  const evidence =
    proven.length > 0
      ? `${proven.length} task${proven.length === 1 ? "" : "s"} passed checks that ${productName()} ran itself; the rest were reviewed by a second model reading the output, with nothing executed.`
      : `"Reviewed" here means a second model read the output; nothing was executed to check it.`;
  const md = [
    `# Delivery — ${run.title}`,
    ``,
    `#agentic-os/run · [[Agentic OS/Runs/${run.id}/Run|the run]]`,
    ``,
    `> ${done.length} of ${run.tasks.length} tasks done${failed.length ? `, ${failed.length} failed` : ""}${unreviewed.length ? `, ${unreviewed.length} accepted without a review` : ""}. ${evidence}`,
    ``,
    body.trim() || "_Nothing was produced: every task failed._",
    ``,
    ...(where ? [`## Where the work is`, ``, where, ``] : []),
    `## Tasks`,
    ``,
    ...run.tasks.map((t) => {
      const tries = t.attempts + (t.status === "done" ? 1 : 0);
      const worker = t.tool ? ` · done by ${workerLabel(t.tool)}${t.model ? ` (${t.model})` : ""}${elsewhere(run, t) ? ` on ${t.hostLabel}` : ""}${t.workTier !== t.tier ? `, moved up from ${t.tier} to ${t.workTier}` : ""}` : "";
      const results = t.checkResults ?? [];
      const checksLine = results.length ? ` · checks: ${results.map((r) => `${r.name} ${r.ran ? (r.ok ? "passed" : "FAILED") : "not run"}`).join(", ")}` : "";
      const review = `${checksLine}${t.reviewNote ? ` · ${t.reviewNote}` : t.reviewedBy ? ` · reviewed by ${t.reviewedBy}` : ""}`;
      return `- **${t.id} ${t.title}** — ${t.status}${worker}${review} · ${tries} attempt${tries === 1 ? "" : "s"} · [[Agentic OS/Runs/${run.id}/tasks/${t.id}|detail]]${t.status === "failed" ? ` — ${t.error ?? ""}` : ""}`;
    }),
    ``,
  ].join("\n");
  await fsp.writeFile(path.join(dirOf(id), "Delivery.md"), md, "utf8").catch(() => {});
  await saveLessons(run, dirOf(id));
  await withRun(id, (x) => {
    if (x.status !== "delivering") return;
    x.status = ok ? "done" : "failed";
    if (!ok) x.error = "Every task failed.";
    x.delivery = clip(body, MAX_RESULT);
    x.finishedAt = Date.now();
  });
  await boardFinish(run.boardTaskId, ok);
  await log(id, ok ? `Delivered: ${done.length} of ${run.tasks.length} tasks done.` : "Run failed: no task produced a result.");
  void sendTelegram(
    ok
      ? `🧭 Run finished: "${run.title.slice(0, 100)}"\n${done.length} of ${run.tasks.length} tasks done${failed.length ? ` (${failed.length} failed)` : ""}${unreviewed.length ? ` · ${unreviewed.length} not reviewed` : ""}. Delivery is in the vault.${where ? `\n\n${where}` : ""}\n\n${body.slice(0, 500)}`
      : `🧭❌ Run failed: "${run.title.slice(0, 100)}" — no task produced a result.`,
  ).catch(() => {});
}

/** One pass over a running run: collect finished jobs, send finished work to review, start what is ready. */
async function step(id: string): Promise<void> {
  const run0 = await readRun(id);
  if (!run0 || run0.status !== "running") return;
  const jobs = await listJobs();
  const snap = await sessionsSnapshot();
  const { sessions, remote } = await mergeRemoteSessions(snap.sessions);
  const machines = placementMachines(run0, snap.subscriptions, sessions, remote, jobs);
  const scale = (await readWorkerModelSettings()).budgetScale ?? 1;
  const budget = (tier: Tier) => Math.round(TIME_BUDGET_MS[tier] * scale);

  // decide which workers ready tasks get BEFORE taking the lock (it may fetch the Nous price list)
  const ready = run0.tasks.filter((t) => t.status === "pending" && t.dependsOn.every((d) => run0.tasks.find((x) => x.id === d)?.status === "done"));
  const picks = new Map<string, Worker>();
  let local: LocalModel | null | undefined; // looked up once, and only if some task could use it
  for (const t of ready) {
    if (t.sessionKey && (t.feedback || t.continueNext)) continue;
    if (local === undefined && fitsLocal(run0, t)) local = await localWorker(run0);
    const w = await chooseWorker(run0, t, machines, local ?? null);
    picks.set(t.id, w);
    // the next ready task in this pass sees that machine one busier, so two tasks don't pile onto one idle machine
    const m = w.tool === "local" ? undefined : machines.find((x) => x.host === w.host);
    if (m) m.busy++;
  }

  const lines: string[] = [];
  const overdue: string[] = [];
  const abandoned: string[] = [];
  const checksToStart: { taskId: string; jobId: string; name: string }[] = [];
  const toStart: { task: RunTask; mode: "new" | "reply"; prompt: string }[] = [];
  const settled: RunTask[] = [];
  const state = await withRun(id, (run) => {
    if (run.status !== "running") return null;
    const byId = (tid: string) => run.tasks.find((x) => x.id === tid);

    for (const t of run.tasks) {
      // 1. a job finished (or never started)
      if (t.status === "running" && t.job) {
        const job: SessionJob | undefined = jobs.find((j) => j.id === t.job!.id);
        if (!job) {
          // the id was recorded but the job never got created (a crash in between): start it again under the same id
          if (Date.now() - t.job.at > 90_000) toStart.push({ task: t, mode: t.job.mode, prompt: t.job.mode === "reply" ? (t.continueNext ? continuePrompt(t, Math.round(budget(t.workTier) / 60_000)) : reworkPrompt(t)) : workPrompt(run, t) });
          continue;
        }
        // A job sent to another machine that has not started there in time: that machine is off,
        // asleep, full or not syncing. Take the task back and place it elsewhere; the worker never
        // saw it, so no attempt is used. (Not for the run's own machine: there is nowhere else to go.)
        const patience = PICKUP_PATIENCE_MS[job.via === "lan" ? "lan" : "vault"];
        if (job.status === "sent" && job.host !== me() && job.host !== run.host && Date.now() - job.createdAt > patience) {
          overdue.push(job.id); // the stop travels the same way, after the request, in case it arrives late
          abandoned.push(job.id);
          noteAttempt(t, "not picked up", `${job.hostLabel}, ${Math.round(patience / 60_000)} minutes`);
          t.avoid = [...new Set([...(t.avoid ?? []), job.host])];
          if (t.job.mode === "reply") t.sessionKey = undefined; // that session lives over there
          t.job = undefined;
          t.host = t.hostLabel = t.folder = undefined;
          t.status = "pending";
          lines.push(`${t.id}: ${job.hostLabel} did not start it within ${Math.round(patience / 60_000)} minutes → placing it on another machine (no attempt used).`);
          continue;
        }
        // A worker that is still going past its tier's time budget is stopped and counted as a
        // failed attempt, so the task moves to another model or up a tier instead of sitting there.
        if (job.status === "running" && job.startedAt && Date.now() - job.startedAt > budget(t.workTier)) {
          overdue.push(job.id);
          const minutes = Math.max(1, Math.round(budget(t.workTier) / 60_000));
          const mins = `${minutes} minute${minutes === 1 ? "" : "s"}`;
          // the session it was writing to: where a continuation (or a counted retry) picks up
          if (job.liveKey && t.tool === "claude" && t.workTier !== "routine") t.sessionKey = job.liveKey;
          // a long piece of real work carries on in its own session instead of starting over (MAX_CONTINUE)
          if (job.liveKey && t.tool === "claude" && t.workTier !== "routine" && (t.continued ?? 0) < MAX_CONTINUE) {
            t.continued = (t.continued ?? 0) + 1;
            t.continueNext = true;
            t.job = undefined;
            t.status = "pending";
            noteAttempt(t, "continued", `stopped after ${mins}, continuing in the same session (${t.continued} of ${MAX_CONTINUE})`);
            lines.push(`${t.id}: ${workerLabel(t.tool)} was still working after ${mins} → stopped, and told to carry on in the same session (${t.continued} of ${MAX_CONTINUE}; not counted as a failure).`);
            continue;
          }
          lines.push(afterFailure(run, t, `${workerLabel(t.tool ?? "claude")} was still working after ${mins} and was stopped`, "timed out"));
          if ((t.status as TaskStatus) === "failed") settled.push(t);
          continue;
        }
        if (job.status === "done") {
          let text = (job.reply ?? "").trim();
          const wasContinuation = !!t.continueNext;
          t.continueNext = undefined;
          if (text && t.job?.mode === "reply" && !wasContinuation && t.result?.trim() && !/^\s*BLOCKED:/i.test(text)) text = afterRework(t, t.result.trim(), text);
          if (job.resultKey) t.sessionKey = job.resultKey;
          t.job = undefined;
          if (!text) lines.push(afterFailure(run, t, "the worker returned nothing"));
          else if (/^\s*BLOCKED:/i.test(text)) {
            t.result = clip(text, MAX_RESULT);
            lines.push(afterFailure(run, t, `the worker was blocked: ${text.replace(/\s+/g, " ").slice(8, 160)}`, "blocked"));
          } else {
            t.result = clip(text, MAX_RESULT);
            t.reviewTries = 0;
            t.checkResults = []; // a new attempt has to prove itself again
            const must = t.checks ?? [];
            t.status = must.length ? "checking" : "review";
            lines.push(`${t.id} finished by ${workerLabel(t.tool ?? "claude")}${t.model ? ` (${t.model})` : ""} → ${must.length ? `running ${must.length === 1 ? `the check "${must[0]}"` : `${must.length} checks`}` : "review"}.`);
          }
        } else if (job.status === "error" || job.status === "expired") {
          lines.push(afterFailure(run, t, `${workerLabel(t.tool ?? "claude")} could not run it: ${(job.error ?? job.status).replace(/\s+/g, " ").slice(0, 160)}`));
        }
        if ((t.status as TaskStatus) === "failed") settled.push(t);
      }
    }

    // 1b. evidence: the task's checks, one at a time, before anyone reviews it
    for (const t of run.tasks) {
      if (t.status !== "checking") continue;
      if (t.checkJob) {
        const job = jobs.find((j) => j.id === t.checkJob!.id);
        if (!job) {
          if (Date.now() - t.checkJob.at > 90_000) checksToStart.push({ taskId: t.id, jobId: t.checkJob.id, name: t.checkJob.name });
          continue;
        }
        if (job.status !== "done" && job.status !== "error" && job.status !== "expired") continue;
        const name = t.checkJob.name;
        const ok = job.status === "done" && job.exitCode === 0;
        (t.checkResults ??= []).push({ name, ran: true, ok, exitCode: job.exitCode, summary: (job.reply ?? "").slice(-1500), at: Date.now() });
        t.checkJob = undefined;
        if (!ok) {
          // the worker is sent the command's own words, not a paraphrase
          t.feedback = `${productName()} ran the check "${name}" itself after your work, and it FAILED: ${job.error ?? "it did not pass"}\n\nThe end of its output:\n${(job.reply ?? "(no output)").slice(-2500)}`;
          lines.push(afterFailure(run, t, `the check "${name}" failed (${(job.error ?? "did not pass").slice(0, 100)})`, "check failed"));
          if ((t.status as TaskStatus) === "failed") settled.push(t);
          continue;
        }
        lines.push(`${t.id} passed the check "${name}".`);
      }
      const next = (t.checks ?? []).find((n) => !(t.checkResults ?? []).some((r) => r.name === n));
      if (!next) {
        t.status = "review";
        t.reviewTries = 0;
        lines.push(`${t.id} → review, with its check results.`);
        continue;
      }
      t.checkJob = { id: newJobId(), name: next, at: Date.now() };
      checksToStart.push({ taskId: t.id, jobId: t.checkJob.id, name: next });
    }

    // 2. a task whose dependency failed can never run
    for (const t of run.tasks) {
      if (t.status !== "pending") continue;
      const dead = t.dependsOn.find((d) => byId(d)?.status === "failed");
      if (dead) {
        t.status = "failed";
        t.error = `not started: it depends on ${dead}, which failed`;
        t.finishedAt = Date.now();
        lines.push(`${t.id} cancelled: ${dead} failed.`);
        settled.push(t);
      }
    }

    // 3. start what is ready
    // Tasks that edit files take turns: one holds the folder from its first start until it is done
    // or has failed, rework included. Two workers editing one folder at once could undo each other,
    // and neither's diff or commit would be its own.
    const holdsFolder = (o: RunTask) => o.access === "edit" && o.status !== "done" && o.status !== "failed" && (o.status !== "pending" || o.startedAt !== undefined);
    for (const t of run.tasks) {
      if (t.status !== "pending" || !t.dependsOn.every((d) => byId(d)?.status === "done")) continue;
      if (t.access === "edit" && run.tasks.some((o) => o !== t && holdsFolder(o))) continue;
      const cont = !!(t.sessionKey && t.continueNext);
      const reply = cont || !!(t.sessionKey && t.feedback);
      if (!reply) {
        const w = picks.get(t.id);
        if (!w) continue; // became ready during this pass; next tick picks its worker
        t.tool = w.tool;
        t.model = w.model;
        t.why = w.why;
        t.agent = w.agent;
        t.host = w.host;
        t.hostLabel = w.hostLabel;
        t.folder = w.folder;
        if (w.tool === "local") {
          // no job: the call is made after this is written, and made again if the server restarts meanwhile
          t.triedLocal = true;
          t.local = { at: Date.now() };
          t.job = undefined;
          t.status = "running";
          t.startedAt ??= Date.now();
          lines.push(`${t.id} started: ${t.why}.`);
          continue;
        }
      }
      // the id goes into the run first; the job is started after this is written
      t.job = { id: newJobId(), mode: reply ? "reply" : "new", at: Date.now() };
      t.jobIds.push(t.job.id);
      t.status = "running";
      t.startedAt ??= Date.now();
      toStart.push({ task: { ...t }, mode: t.job.mode, prompt: cont ? continuePrompt(t, Math.round(budget(t.workTier) / 60_000)) : reply ? reworkPrompt(t) : workPrompt(run, t) });
      if (cont) {
        lines.push(`${t.id} continuing in the same ${workerLabel(t.tool ?? "claude")} session.`);
        continue;
      }
      lines.push(reply ? `${t.id} sent back to the same ${workerLabel(t.tool ?? "claude")} session${elsewhere(run, t) ? ` on ${t.hostLabel}` : ""} with the review.` : `${t.id} started: ${t.why}.`);
    }

    // 4. nothing left to do → deliver
    if (run.tasks.every((t) => t.status === "done" || t.status === "failed")) run.status = "delivering";
    return run;
  });
  for (const l of lines) await log(id, l);
  for (const jobId of overdue) await startJob({ mode: "stop", jobId }).catch(() => {});
  for (const jobId of abandoned) await abandonRemoteJob(jobId, "Not started there in time; the project run placed the task elsewhere.").catch(() => {});
  if (!state) return;
  for (const t of settled) await writeTaskNote(state, t);
  for (const t of settled) if (t.access === "edit" && state.git) await settleGit(id, t.id);
  for (const t of state.tasks) if (t.status === "review") detach(`${id}:review:${t.id}`, () => review(id, t.id));
  for (const t of state.tasks) if (t.status === "running" && t.local) detach(`${id}:local:${t.id}`, () => localWork(id, t.id));

  for (const c of checksToStart) {
    try {
      await startJob({ mode: "check", id: c.jobId, folder: state.folder, check: c.name, project: state.project });
    } catch (e) {
      // A check that can't even start is not the worker's failure. Record that it did not run, so
      // the reviewer and the delivery say "unproven" instead of quietly counting it as passed.
      const why = (e as Error).message;
      await withRun(id, (run) => {
        const task = run.tasks.find((x) => x.id === c.taskId);
        if (!task || task.checkJob?.id !== c.jobId) return;
        task.checkJob = undefined;
        (task.checkResults ??= []).push({ name: c.name, ran: false, ok: false, summary: why.slice(0, 300), at: Date.now() });
      });
      await log(id, `${c.taskId}: the check "${c.name}" could not be run: ${why}`);
    }
  }

  for (const s of toStart) {
    const t = s.task;
    if (!t.job || t.tool === "local") continue; // the local model is not started as a job (see localWork)
    try {
      const job = await startJob(
        s.mode === "reply"
          ? { mode: "reply", id: t.job.id, key: t.sessionKey, host: t.host ?? state.host, folder: t.folder ?? state.folder, prompt: s.prompt, access: t.access, model: t.tool === "hermes" ? t.model : undefined, web: t.tool === "hermes" ? t.needsWeb : undefined, maxTurns: t.tool === "hermes" ? HERMES_TURNS[t.workTier] : undefined, isolated: true }
          : { mode: "new", id: t.job.id, host: t.host ?? state.host, folder: t.folder ?? state.folder, tool: t.tool, project: state.project, prompt: s.prompt, access: t.access, model: t.model, web: t.tool === "hermes" ? t.needsWeb : undefined, maxTurns: t.tool === "hermes" ? HERMES_TURNS[t.workTier] : undefined, isolated: true, dispatch: `run ${state.title.slice(0, 60)} · ${t.id}` },
      );
      // a refusal comes back as an error job, picked up on the next pass like any other failure
      void job;
    } catch (e) {
      const msg = (e as Error).message;
      const line = await withRun(id, (run) => {
        const task = run.tasks.find((x) => x.id === t.id);
        if (!task || task.job?.id !== t.job!.id) return "";
        // a reply that can't be sent (the session is gone from the list) must not be retried as a reply forever
        if (s.mode === "reply") task.sessionKey = undefined;
        return afterFailure(run, task, `could not start: ${msg.slice(0, 160)}`);
      });
      if (line) await log(id, line);
    }
  }
}

async function applyCommands(id: string): Promise<void> {
  const dir = path.join(dirOf(id), "commands");
  const names = (await fsp.readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith(".json")).sort();
  for (const n of names) {
    const file = path.join(dir, n);
    let cmd: { action?: string; by?: string } = {};
    try {
      cmd = JSON.parse(await fsp.readFile(file, "utf8"));
    } catch {
      /* half-synced or junk: drop it */
    }
    await fsp.unlink(file).catch(() => {});
    const by = cmd.by || "someone";
    if (cmd.action === "pause") {
      const did = await withRun(id, (run) => {
        if (!ACTIVE.includes(run.status)) return false;
        run.pausedFrom = run.status;
        run.status = "paused";
        return true;
      });
      if (did) await log(id, `Paused by ${by}. Sessions already running will finish; nothing new starts.`);
    } else if (cmd.action === "resume") {
      const did = await withRun(id, (run) => {
        if (run.status !== "paused") return false;
        run.status = run.pausedFrom ?? "running";
        run.pausedFrom = undefined;
        return true;
      });
      if (did) await log(id, `Resumed by ${by}.`);
    } else if (cmd.action === "stop") {
      const stopped = await withRun(id, (run) => {
        if (["done", "failed", "stopped"].includes(run.status)) return null;
        const running = run.tasks.filter((t) => t.status === "running" && t.job).map((t) => t.job!.id);
        run.status = "stopped";
        run.error = `Stopped by ${by}.`;
        run.finishedAt = Date.now();
        return { running, board: run.boardTaskId, git: run.git && !run.git.returned ? run.git : undefined };
      });
      if (stopped) {
        for (const jobId of stopped.running) await startJob({ mode: "stop", jobId }).catch(() => {});
        await boardFinish(stopped.board, false);
        await log(id, `Stopped by ${by}.${stopped.git ? ` The folder is still on the run's branch ${stopped.git.branch}; its accepted tasks are committed there. To go back: git switch ${stopped.git.base}.` : ""}`);
      }
    }
  }
}

/**
 * Every machine, every 20 seconds: advance the runs THIS machine drives. Cheap
 * when there are none. Only the scheduler's module instance calls this (see
 * lib/scheduler.ts) — API routes must go through commandRun().
 */
export async function runsTick(): Promise<void> {
  if (!(await vaultAvailable())) return;
  // newest 80 by name (names start with the date): old finished runs are not re-read every 20 seconds
  const names = (await fsp.readdir(runsDir()).catch(() => [] as string[])).filter((n) => RUN_ID_RE.test(n)).sort().reverse().slice(0, 80);
  for (const id of names) {
    const run = await readRun(id);
    if (!run || run.driver !== me()) continue;
    if (!ACTIVE.includes(run.status) && run.status !== "paused") continue;
    await applyCommands(id);
    const now = await readRun(id);
    if (!now) continue;
    if (now.status === "planning") detach(`${id}:plan`, () => plan(id));
    else if (now.status === "awaiting_approval") await checkApproval(id).catch(() => {});
    else if (now.status === "running") await step(id).catch((e: Error) => console.error(`[mission-control] run ${id}: ${e.message}`));
    else if (now.status === "delivering") detach(`${id}:deliver`, () => deliver(id));
  }
}
