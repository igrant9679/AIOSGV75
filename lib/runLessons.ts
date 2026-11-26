import fsp from "fs/promises";
import path from "path";
import { todayStamp, vaultInfo } from "./vault";
import { workerLabel } from "./sessionTools";
import type { Run, RunTask, Tier } from "./runs";

/**
 * Phase 4 of project runs: what a run teaches, kept, and handed to the next plan.
 *
 * Every attempt at a task leaves a short note on the task (`history`: who did it,
 * at what tier, on which machine, and how it ended). From those notes, with no
 * extra model call:
 *
 *  - LESSONS. At delivery, the tasks that did not go smoothly (rejected, a check
 *    failed, moved up a tier, a machine that never picked one up) are written to
 *    the run's Lessons.md and appended to one file per project under
 *    Agentic OS/Runs/Lessons/. The next run for the same project gives its
 *    planner the end of that file, so it can pick tiers and write briefs with
 *    what went wrong last time in front of it.
 *  - THE RECORD. How often each worker's attempts passed review, per tier, over
 *    the recent runs: shown on the Runs page and given to the planner too.
 *
 * Nothing here changes the rules in Agentic OS/Rules.md or the shared memory:
 * lessons stay in the runs' own folder, as data for planners (AGENTS.md rule 15:
 * agent behaviour lives in the vault, and the owner decides what goes into Rules).
 */

export type Outcome = "passed" | "unreviewed" | "rejected" | "check failed" | "blocked" | "error" | "timed out" | "not picked up";

export interface AttemptNote {
  at: number;
  outcome: Outcome;
  tool?: string;
  model?: string;
  tier: Tier;
  host?: string;
  /** a short why: the reviewer's words, the check's name, the error */
  note?: string;
}

const MAX_NOTES = 16;
const LESSONS_TAIL = 2500;

export function noteAttempt(t: RunTask, outcome: Outcome, note?: string): void {
  const h = (t.history ??= []);
  h.push({ at: Date.now(), outcome, tool: t.tool, model: t.model, tier: t.workTier, host: t.hostLabel, note: note?.replace(/\s+/g, " ").slice(0, 220) });
  if (h.length > MAX_NOTES) h.splice(0, h.length - MAX_NOTES);
}

const lessonsDir = () => path.join(vaultInfo().base, "Runs", "Lessons");

/** One lessons file per project (or folder, or "home folder"), so a run learns from runs on the same work. */
export function lessonsKey(run: Pick<Run, "project" | "folder">): string {
  const raw = run.project?.trim() || (run.folder === "~" ? "home folder" : path.basename(run.folder.replace(/[\\/]+$/, "")) || "home folder");
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "home-folder";
}

const who = (n: AttemptNote) => `${n.tool ? workerLabel(n.tool) : "a worker"}${n.model ? ` (${n.model})` : ""}`;

/** The lines worth remembering from one task, or none if it went through first time. */
function taskLessons(t: RunTask): string[] {
  const h = t.history ?? [];
  const bad = h.filter((n) => n.outcome !== "passed" && n.outcome !== "unreviewed");
  if (!bad.length && t.workTier === t.tier) return [];
  const parts: string[] = [];
  for (const n of bad) {
    if (n.outcome === "not picked up") parts.push(`${n.host ?? "a machine"} did not pick it up`);
    else if (n.outcome === "rejected") parts.push(`${who(n)} at ${n.tier} was rejected: "${n.note ?? ""}"`);
    else if (n.outcome === "check failed") parts.push(`${who(n)}'s work failed a check (${n.note ?? ""})`);
    else if (n.outcome === "timed out") parts.push(`${who(n)} ran out of time at ${n.tier}`);
    else parts.push(`${who(n)} at ${n.tier}: ${n.outcome}${n.note ? ` (${n.note})` : ""}`);
  }
  const end = h[h.length - 1];
  const ending =
    t.status === "done"
      ? `done by ${end ? who(end) : "a worker"}${t.workTier !== t.tier ? ` after moving up from ${t.tier} to ${t.workTier}` : ""}`
      : `FAILED${t.error ? `: ${t.error.slice(0, 160)}` : ""}`;
  return [`- **${t.title}** (planned ${t.tier}${t.access === "edit" ? ", edits files" : ""}): ${parts.join("; ")}. Finally ${ending}.`];
}

export function runLessons(run: Run): string {
  const lines = run.tasks.flatMap(taskLessons);
  const smooth = run.tasks.filter((t) => t.status === "done" && !taskLessons(t).length);
  return [
    ...lines,
    ...(smooth.length ? [`- First time, as planned: ${smooth.map((t) => `${t.title} (${t.tier}, ${(t.history ?? []).slice(-1)[0] ? who((t.history ?? []).slice(-1)[0]) : t.tool ? workerLabel(t.tool) : "?"})`).join("; ")}.`] : []),
  ].join("\n");
}

/** Write the run's Lessons.md and add its lessons to the project's file. Never throws. */
export async function saveLessons(run: Run, runDir: string): Promise<void> {
  const body = runLessons(run);
  if (!body.trim()) return;
  const runLink = `[[Agentic OS/Runs/${run.id}/Run|${run.title}]]`;
  await fsp
    .writeFile(path.join(runDir, "Lessons.md"), [`# Lessons — ${run.title}`, ``, `#agentic-os/run · ${runLink}`, ``, `> What this run taught, from its own record. The next run for the same project gives these to its planner.`, ``, body, ``].join("\n"), "utf8")
    .catch(() => {});
  // only what went wrong is worth carrying forward; a run where everything passed adds one short line
  const carry = body
    .split("\n")
    .filter((l) => !l.startsWith("- First time"))
    .join("\n");
  const file = path.join(lessonsDir(), `${lessonsKey(run)}.md`);
  try {
    await fsp.mkdir(lessonsDir(), { recursive: true });
    const exists = await fsp.stat(file).then(() => true).catch(() => false);
    const head = exists ? "" : `# Run lessons — ${run.project || (run.folder === "~" ? "home folder" : run.folder)}\n\n#agentic-os/run\n\n> Appended by each project run at delivery. Planners read the end of this file. Edit or prune it freely.\n\n`;
    const day = todayStamp(); // the local date, like every other dated note
    await fsp.appendFile(file, `${head}## ${day} · ${runLink}\n\n${carry.trim() || "- Every task passed first time, at the tier planned."}\n\n`, "utf8");
  } catch {
    /* lessons are a help, never a reason to fail a delivery */
  }
}

/** The end of the project's lessons file, for the planner ("" if there is none). */
export async function readLessons(run: Pick<Run, "project" | "folder">): Promise<string> {
  const text = await fsp.readFile(path.join(lessonsDir(), `${lessonsKey(run)}.md`), "utf8").catch(() => "");
  if (!text.trim()) return "";
  // keep whole entries from the end
  const entries = text.split(/\n(?=## )/).slice(1);
  const out: string[] = [];
  let size = 0;
  for (const e of entries.reverse()) {
    if (size + e.length > LESSONS_TAIL && out.length) break;
    out.unshift(e.trim());
    size += e.length;
  }
  return out.join("\n\n").slice(-LESSONS_TAIL * 1.5);
}

export interface RecordRow {
  tool: string;
  tier: Tier;
  passed: number;
  tries: number;
}

/**
 * How each worker's attempts have fared, per tier, over the given runs: reviewed attempts only
 * (passed vs rejected or failed a check). Errors, time-outs and machines that never picked a task up
 * are about the plumbing, not the worker's judgement, and are left out.
 */
export function workerRecord(runs: Run[]): RecordRow[] {
  const rows = new Map<string, RecordRow>();
  for (const r of runs)
    for (const t of r.tasks)
      for (const n of t.history ?? []) {
        if (!n.tool || !["passed", "rejected", "check failed"].includes(n.outcome)) continue;
        const k = `${n.tool}|${n.tier}`;
        const row = rows.get(k) ?? { tool: n.tool, tier: n.tier, passed: 0, tries: 0 };
        row.tries++;
        if (n.outcome === "passed") row.passed++;
        rows.set(k, row);
      }
  const order: Tier[] = ["routine", "standard", "hard"];
  return [...rows.values()].sort((a, b) => order.indexOf(a.tier) - order.indexOf(b.tier) || b.tries - a.tries);
}

export function recordText(rows: RecordRow[], min = 3): string {
  return rows
    .filter((r) => r.tries >= min)
    .map((r) => `- ${r.tier} work by ${workerLabel(r.tool)}: ${r.passed} of ${r.tries} attempts passed review`)
    .join("\n");
}
