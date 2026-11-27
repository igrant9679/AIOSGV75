import type { SessionTool } from "./sessionTools";
import type { SubscriptionMeter } from "./sessions";

/**
 * Where a project-run task should run: which machine, in which folder, with
 * which of the tools its tier allows. Pure on purpose (types only, no I/O), so
 * the rules can be tested without a fleet: lib/runs.ts gathers the facts and
 * asks here.
 *
 * The rules, in the order they bite:
 *
 *  - A task that EDITS FILES, or must pass checks, stays on the run's own
 *    machine and folder. Edits made on two machines would leave two different
 *    copies of the project, and checks run where the files are.
 *  - A run that was not started with "spread" keeps every task on its machine
 *    (that is how every run before phase 3 behaved).
 *  - Otherwise an answer-only task may go to any machine that is online,
 *    accepts work from the others, runs a version that honours a run's limits
 *    (model, turn cap, time budget — `runWorker`), has the tool set up and not
 *    at its limit, and has the project's folder (or the run works in the home
 *    folder, which every machine has).
 *  - A machine whose memory is nearly full (MEM_FULL, lib/machineLoad.ts) gets nothing new
 *    from another machine: one more agent there is how Raider18 crashed. Its own run's tasks
 *    still go to it (they cannot move), but anything that can go elsewhere does.
 *  - Among those, the least busy wins; the run's own machine gets an edge, a machine
 *    reached only through OneDrive pays for its minutes of latency, and a machine over
 *    MEM_WARN pays for every point above it.
 *  - The tier fixes the order of tools. The cheapest tool that has ANY machine
 *    wins; machines only compete within that tool. Spreading never makes a task
 *    dearer.
 */

export interface PlacementMachine {
  host: string;
  label: string;
  /** the machine the run works on (its folder holds the project) */
  home: boolean;
  online: boolean;
  /** "self" = the machine making the decision; others are reached over the LAN or through the vault */
  via: "self" | "lan" | "vault";
  /** that machine's "Replies from my other machines" setting ("edit" for this machine) */
  accepts: "off" | "answer" | "edit";
  /** runs a version that honours a run's model, turn cap and web choice */
  runWorker: boolean;
  subs: SubscriptionMeter[];
  /** sessions running there plus jobs in flight there, including tasks placed earlier in this pass */
  busy: number;
  /** the project's folder on that machine ("~" = home folder); undefined = it does not have one */
  folder?: string;
  /** memory pressure, % (Windows commit charge, else RAM); undefined = not known */
  memory?: number;
  /** the local model it shares for "local" jobs (name only), when one is running there */
  localModel?: string;
  /** local-model jobs in flight there, including ones placed earlier in this pass */
  localBusy?: number;
  /** false = it said it hasn't the free memory to load its local model now */
  localFits?: boolean;
}

export interface PlacementTask {
  /** tools in the order the tier prefers them */
  tools: SessionTool[];
  /** must run on the run's own machine: it edits files, has checks, or the run does not spread */
  pinned: boolean;
  /** machines that failed to pick this task up before */
  avoid?: string[];
}

export interface Placement {
  tool: SessionTool;
  host: string;
  label: string;
  folder: string;
  home: boolean;
  /** why this machine, in a few words */
  why: string;
  /** tools skipped because no machine could run them */
  skipped: SessionTool[];
}

/** A machine that already has this many of our jobs is full: more would only queue there. */
export const MACHINE_SLOTS = 2;

/** Memory pressure (%) at which a machine is avoided, and at which it gets nothing new from elsewhere. */
export const MEM_WARN = 85;
export const MEM_FULL = 93;

export function toolUsable(m: PlacementMachine, tool: SessionTool): boolean {
  const meter = m.subs.find((s) => s.tool === tool);
  // Claude is the one tool every machine in the group is assumed to have
  if (tool === "claude") return meter?.status !== "limited";
  return !!meter && meter.status !== "not_set_up" && meter.status !== "limited";
}

/** Why a machine cannot take the task with this tool, or null when it can. */
export function blockedReason(m: PlacementMachine, task: PlacementTask, tool: SessionTool): string | null {
  if (task.pinned && !m.home) return "the task stays on the run's machine";
  if (!m.online) return "offline";
  if (!toolUsable(m, tool)) return `${tool} is not available there`;
  if (m.home) return null; // the run's own machine was accepted when the run was created
  if ((task.avoid ?? []).includes(m.host)) return "did not pick it up last time";
  if (m.accepts === "off") return "does not accept work from other machines";
  if (!m.runWorker) return "runs an older version (update it to share run work)";
  if (m.folder === undefined) return "does not have the project's folder";
  if (m.busy >= MACHINE_SLOTS) return "busy";
  if ((m.memory ?? 0) >= MEM_FULL) return `memory nearly full (${m.memory}%)`;
  return null;
}

export function score(m: PlacementMachine, tool: SessionTool): number {
  const meter = m.subs.find((s) => s.tool === tool);
  const used = typeof meter?.usedPercent === "number" ? meter.usedPercent : 50;
  const tight = Math.max(0, (m.memory ?? 0) - MEM_WARN) * 0.15; // 0 below MEM_WARN, 1.2 at MEM_FULL
  return (used / 100) * 1.5 + m.busy * 0.7 + (m.home ? -0.4 : 0) + (m.via === "vault" ? 1.5 : 0) + tight;
}

export function placeTask(machines: PlacementMachine[], task: PlacementTask): Placement | null {
  const skipped: SessionTool[] = [];
  for (const tool of task.tools) {
    const ok = machines.filter((m) => blockedReason(m, task, tool) === null);
    if (!ok.length) {
      skipped.push(tool);
      continue;
    }
    const best = ok.sort((a, b) => score(a, tool) - score(b, tool) || Number(b.home) - Number(a.home))[0];
    const home = machines.find((m) => m.home);
    let why: string;
    if (best.home) why = task.pinned ? "on the run's machine" : best.busy ? `on the run's machine (${best.busy} busy there)` : "on the run's machine";
    else why = `on ${best.label}: ${home ? `${home.label} has ${home.busy} running` : "the run's machine is not available"}, ${best.label} ${best.busy ? `has ${best.busy}` : "is idle"}${best.via === "vault" ? ", reached through OneDrive" : ""}`;
    return { tool, host: best.host, label: best.label, folder: best.folder ?? "~", home: best.home, why, skipped };
  }
  return null;
}

/**
 * Another machine's local model for a routine, text-only task, when the machine driving the run has
 * none it may use (lib/runs.ts asks only for spreading runs; such a task needs no folder). A machine
 * qualifies when it is online, is not the one deciding, accepts work from the others, advertises a
 * local model that is running (`localModel`, shared only by versions that take "local" jobs), was not
 * skipped for this task before, says it has the free memory to load that model now (`localFits`:
 * loading takes ~1.4x the model's size in commit even on a GPU), has memory below MEM_WARN (a local model loads gigabytes:
 * inkling-2-mini is 18 GB; unknown memory is allowed, rule 31), and has no local task already in
 * flight (Ollama answers one at a time; a second would wait with its time limit running).
 * Best: on the LAN, then the least memory used, then the least busy.
 */
export function pickLocalMachine(machines: PlacementMachine[], avoid: string[] = []): PlacementMachine | null {
  const ok = machines.filter(
    (m) => m.via !== "self" && m.online && m.accepts !== "off" && !!m.localModel && m.localFits !== false && !avoid.includes(m.host) && (m.memory ?? 0) < MEM_WARN && (m.localBusy ?? 0) === 0,
  );
  const mem = (m: PlacementMachine) => m.memory ?? MEM_WARN - 5;
  return ok.sort((a, b) => Number(a.via === "vault") - Number(b.via === "vault") || mem(a) - mem(b) || a.busy - b.busy)[0] ?? null;
}
