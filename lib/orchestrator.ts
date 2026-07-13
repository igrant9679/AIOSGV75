import fs from "fs/promises";
import path from "path";
import { runAgentText } from "./runners";
import { sendTelegram } from "./telegram";
import { readTasks, writeTasks, newTaskId } from "./tasks";
import { vaultInfo, vaultAvailable, todayStamp } from "./vault";

/**
 * The Orchestrator: takes one goal and runs the full chief-of-staff loop —
 *   plan     Claude decomposes the goal into ≤5 self-contained subtasks
 *   dispatch each subtask goes to "auto" (the router picks the cheapest
 *            capable model — that's the token-conservation layer)
 *   review   Claude judges each output: pass, or feedback
 *   rework   failed subtasks re-run with the feedback attached (≤2 attempts)
 *   assemble Claude merges everything into the final deliverable
 * Results archive to the vault; the kanban board tracks the goal's lifecycle.
 * Same persistence discipline as missions: data file is the source of truth,
 * per-orchestration read-modify-write, live overlay for in-flight runs.
 */
export interface OrchStep {
  id: string;
  title: string;
  prompt: string;
  status: "pending" | "running" | "review" | "rework" | "done" | "error";
  attempts: number;
  output: string;
  feedback?: string;
  routedTo?: string;
  ms: number;
}

export interface Orchestration {
  id: string;
  goal: string;
  /** pinned worker agent ids; empty/undefined = "auto" routes each subtask */
  workers?: string[];
  status: "planning" | "running" | "assembling" | "done" | "error";
  createdAt: number;
  finishedAt?: number;
  steps: OrchStep[];
  final?: string;
  error?: string;
  vaultFile?: string;
  boardTaskId?: string;
  plannerNote?: string;
}

const FILE = path.join(process.cwd(), "data", "orchestrations.json");
const MAX_KEPT = 40;
const MAX_STEPS = 5;
const MAX_ATTEMPTS = 3; // 1 first try + 2 reworks
const STALE_MS = 60 * 60_000;

const live = new Map<string, Orchestration>();

async function readDisk(): Promise<Orchestration[]> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8")) as Orchestration[];
  } catch {
    return [];
  }
}

export async function listOrchestrations(): Promise<Orchestration[]> {
  const disk = await readDisk();
  const merged = disk.map((o) => {
    const mine = live.get(o.id);
    if (mine) return mine;
    if (o.status !== "done" && o.status !== "error" && Date.now() - o.createdAt > STALE_MS) {
      o.status = "error";
      o.error = "stalled (no progress for an hour)";
    }
    return o;
  });
  for (const o of live.values()) if (!merged.some((x) => x.id === o.id)) merged.unshift(o);
  return merged;
}

async function save(o: Orchestration): Promise<void> {
  const disk = await readDisk();
  const i = disk.findIndex((x) => x.id === o.id);
  if (i >= 0) disk[i] = o;
  else disk.unshift(o);
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(disk.slice(0, MAX_KEPT), null, 2), "utf8");
}

let seq = 0;

export async function startOrchestration(goal: string, workers?: string[]): Promise<Orchestration> {
  const o: Orchestration = {
    id: `orc-${Date.now().toString(36)}-${seq++}`,
    goal: goal.trim().slice(0, 4000),
    workers: workers && workers.length > 0 ? workers.slice(0, 4) : undefined,
    status: "planning",
    createdAt: Date.now(),
    steps: [],
  };
  live.set(o.id, o);
  await save(o);
  void run(o); // fire and forget — clients poll
  return o;
}

/** Pull the first JSON array/object out of an LLM reply (fences and prose tolerated). */
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

function planPrompt(goal: string): string {
  return [
    `You are the orchestrator of a multi-agent AI system. Decompose this goal into 2-${MAX_STEPS} INDEPENDENT subtasks that different AI agents can each complete in one shot.`,
    ``,
    `GOAL: ${goal}`,
    ``,
    `Rules:`,
    `- Each subtask prompt must be fully self-contained (repeat any needed context from the goal — the agent sees nothing else).`,
    `- Subtasks must not depend on each other's output; the results get assembled afterwards.`,
    `- If the goal is small enough for one agent, return a single subtask.`,
    ``,
    `Return ONLY a JSON array: [{"title": "short name", "prompt": "the full self-contained instruction"}]`,
  ].join("\n");
}

function reviewPrompt(goal: string, step: OrchStep): string {
  return [
    `You are a strict quality reviewer in a multi-agent system. Overall goal: ${goal}`,
    ``,
    `Subtask: ${step.title}`,
    `Instruction given to the agent:`,
    step.prompt,
    ``,
    `The agent's output:`,
    `---`,
    step.output.slice(0, 6000),
    `---`,
    ``,
    `Does this output fully and correctly accomplish the subtask, at a quality you would hand to the owner? Return ONLY JSON: {"pass": true} or {"pass": false, "feedback": "specific, actionable fixes"}`,
  ].join("\n");
}

function reworkPrompt(step: OrchStep): string {
  return [
    step.prompt,
    ``,
    `--- REVISION REQUIRED ---`,
    `Your previous attempt:`,
    step.output.slice(0, 4000),
    ``,
    `Reviewer feedback: ${step.feedback}`,
    ``,
    `Produce the corrected, complete output (not a diff).`,
  ].join("\n");
}

function assemblePrompt(o: Orchestration): string {
  const parts = o.steps
    .map((s) => `--- ${s.title} (${s.status}) ---\n${s.output.trim() || "(no output)"}`)
    .join("\n\n");
  return [
    `You are the orchestrator assembling the final deliverable. The owner's goal:`,
    o.goal,
    ``,
    `Completed subtask outputs:`,
    ``,
    parts,
    ``,
    `Assemble the single, polished final deliverable for the owner. Merge, order, and smooth the pieces; fix small inconsistencies; note anything a failed subtask left missing. Output only the deliverable.`,
  ].join("\n");
}

async function addBoardTask(goal: string): Promise<string | null> {
  try {
    const { tasks, preamble } = await readTasks();
    const task = {
      id: newTaskId(),
      title: `🤖 ${goal.slice(0, 160)}`,
      status: "in_progress" as const,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    tasks.unshift(task);
    await writeTasks(tasks, preamble);
    return task.id;
  } catch {
    return null;
  }
}

async function finishBoardTask(taskId: string | null, ok: boolean): Promise<void> {
  if (!taskId) return;
  try {
    const { tasks, preamble } = await readTasks();
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    task.status = ok ? "done" : "pending"; // failures return to Pending for a human look
    task.updatedAt = Date.now();
    await writeTasks(tasks, preamble);
  } catch {
    /* board unavailable — not fatal */
  }
}

async function archive(o: Orchestration): Promise<string | undefined> {
  if (!(await vaultAvailable())) return undefined;
  try {
    const dir = path.join(vaultInfo().base, "Missions");
    await fs.mkdir(dir, { recursive: true });
    const stamp = new Date().toISOString().slice(11, 16).replace(":", "-");
    const slug = o.goal.slice(0, 40).replace(/[^a-z0-9 ]/gi, "").trim().replace(/\s+/g, "-").toLowerCase() || "orchestration";
    const file = path.join(dir, `${todayStamp()} ${stamp} orchestration-${slug}.md`);
    const md = [
      `# 🤖 Orchestration — ${o.goal.slice(0, 80)}`,
      ``,
      `#agentic-os/mission · [[Agentic OS/Home|Agentic OS]] · ${o.status} · ${o.steps.length} subtasks`,
      ``,
      `**Goal:** ${o.goal}`,
      ``,
      ...o.steps.flatMap((s) => [
        `## ${s.title}`,
        ``,
        `_${s.status} · ${s.attempts} attempt(s) · via ${s.routedTo ?? "auto"} · ${(s.ms / 1000).toFixed(1)}s_`,
        ...(s.feedback ? [``, `> reviewer: ${s.feedback}`] : []),
        ``,
        s.output.trim() || "_(no output)_",
        ``,
      ]),
      `## Final deliverable`,
      ``,
      o.final ?? "_(assembly failed)_",
      ``,
    ].join("\n");
    await fs.writeFile(file, md, "utf8");
    return path.relative(vaultInfo().root, file).replace(/\\/g, "/");
  } catch {
    return undefined;
  }
}

async function run(o: Orchestration): Promise<void> {
  try {
    // ── plan ──
    const plan = await runAgentText("claude", planPrompt(o.goal), { injectMemory: true });
    if (plan.error) throw new Error(`planning failed: ${plan.error}`);
    let subtasks = extractJson<{ title?: string; prompt?: string }[]>(plan.text);
    if (!Array.isArray(subtasks) || subtasks.length === 0) {
      o.plannerNote = "planner returned no parseable plan — running the goal as a single task";
      subtasks = [{ title: "Complete the goal", prompt: o.goal }];
    }
    o.steps = subtasks
      .filter((s) => (s.prompt ?? "").toString().trim())
      .slice(0, MAX_STEPS)
      .map((s, i) => ({
        id: `step-${i}`,
        title: (s.title ?? `Subtask ${i + 1}`).toString().slice(0, 80),
        prompt: (s.prompt ?? "").toString().slice(0, 6000),
        status: "pending" as const,
        attempts: 0,
        output: "",
        ms: 0,
      }));
    o.status = "running";
    o.boardTaskId = (await addBoardTask(o.goal)) ?? undefined;
    await save(o);

    // ── dispatch → review → rework, per step, in parallel ──
    // pinned workers take subtasks round-robin; otherwise "auto" routes each
    await Promise.all(
      o.steps.map(async (step, stepIndex) => {
        const workerId = o.workers?.length ? o.workers[stepIndex % o.workers.length] : "auto";
        while (step.attempts < MAX_ATTEMPTS) {
          step.attempts++;
          step.status = step.attempts === 1 ? "running" : "rework";
          await save(o);

          const prompt = step.attempts === 1 ? step.prompt : reworkPrompt(step);
          // workers get shared memory + vault RAG so subtask output reflects
          // the owner's actual system/projects instead of generic guesses
          const r = await runAgentText(workerId, prompt, { injectMemory: true });
          step.ms += r.ms;
          if (r.error) {
            step.status = "error";
            step.output = step.output || `(errored: ${r.error})`;
            await save(o);
            return;
          }
          step.output = r.text;
          step.routedTo = r.routedTo ?? (workerId !== "auto" ? workerId : step.routedTo);

          step.status = "review";
          await save(o);
          const review = await runAgentText("claude", reviewPrompt(o.goal, step), { injectMemory: false });
          const verdict = review.error ? null : extractJson<{ pass?: boolean; feedback?: string }>(review.text);
          if (!verdict || verdict.pass === true || step.attempts >= MAX_ATTEMPTS) {
            // unreviewable counts as pass; out-of-attempts ships with a note
            step.status = "done";
            if (verdict && verdict.pass === false) step.feedback = `shipped after ${step.attempts} attempts; last feedback: ${verdict.feedback ?? ""}`.slice(0, 400);
            await save(o);
            return;
          }
          step.feedback = (verdict.feedback ?? "quality below bar — improve and retry").slice(0, 1000);
          await save(o);
        }
      }),
    );

    // ── assemble ──
    o.status = "assembling";
    await save(o);
    const doneSteps = o.steps.filter((s) => s.status === "done" && s.output.trim());
    if (doneSteps.length === 0) throw new Error("every subtask failed");
    if (o.steps.length === 1) {
      o.final = o.steps[0].output;
    } else {
      const final = await runAgentText("claude", assemblePrompt(o), { injectMemory: false });
      o.final = final.error ? doneSteps.map((s) => `## ${s.title}\n\n${s.output}`).join("\n\n") : final.text;
    }
    o.status = "done";
  } catch (e) {
    o.status = "error";
    o.error = (e as Error).message;
  }

  o.finishedAt = Date.now();
  o.vaultFile = await archive(o);
  await finishBoardTask(o.boardTaskId ?? null, o.status === "done");
  await save(o);
  live.delete(o.id);

  const failed = o.steps.filter((s) => s.status === "error").length;
  void sendTelegram(
    o.status === "done"
      ? `🤖 Orchestration complete: "${o.goal.slice(0, 100)}"\n${o.steps.length} subtasks${failed ? ` (${failed} failed)` : ""} · result archived to the vault. Preview:\n\n${(o.final ?? "").slice(0, 300)}`
      : `🤖❌ Orchestration failed: "${o.goal.slice(0, 100)}"\n${o.error ?? "unknown error"}`,
  ).catch(() => {});
}
