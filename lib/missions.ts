import fs from "fs/promises";
import path from "path";
import { runAgentText } from "./runners";
import { writeMissionLog } from "./vault";

/**
 * Mission engine: orchestrates multiple agents on one task, server-side, so
 * runs survive page navigation. Strategies:
 *  - single:   one agent answers
 *  - moa:      all agents answer in parallel, a synthesizer merges (Mixture of Agents)
 *  - pipeline: agents run in sequence, each improving the previous output
 */
export type MissionStrategy = "single" | "moa" | "pipeline" | "arena";

export interface MissionResult {
  agentId: string;
  status: "pending" | "running" | "done" | "error";
  text: string;
  ms: number;
  error?: string;
  /** which real agent handled it, when agentId is "auto" */
  routedTo?: string;
}

export interface Mission {
  id: string;
  title: string;
  prompt: string;
  strategy: MissionStrategy;
  agentIds: string[];
  synthesizerId?: string;
  status: "running" | "done" | "error";
  createdAt: number;
  finishedAt?: number;
  results: MissionResult[];
  synthesis?: string;
  synthesisError?: string;
  vaultFile?: string;
}

const FILE = path.join(process.cwd(), "data", "missions.json");
const MAX_KEPT = 100;
const STALE_MS = 30 * 60_000;

/**
 * The JSON file is the source of truth — the scheduler bundle and the API
 * route bundle are separate module instances, so no cross-call cache.
 * `live` holds only missions running in THIS instance, overlaid on reads so
 * in-flight mutations are always visible.
 */
const live = new Map<string, Mission>();

async function readDisk(): Promise<Mission[]> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8")) as Mission[];
  } catch {
    return [];
  }
}

async function load(): Promise<Mission[]> {
  const disk = await readDisk();
  const merged = disk.map((m) => {
    const mine = live.get(m.id);
    if (mine) return mine;
    // a "running" mission that isn't live here may belong to the other bundle
    // instance — only declare it dead once it's implausibly old
    if (m.status === "running" && Date.now() - m.createdAt > STALE_MS) {
      m.status = "error";
      for (const r of m.results) if (r.status === "running" || r.status === "pending") r.status = "error";
    }
    return m;
  });
  for (const m of live.values()) if (!merged.some((x) => x.id === m.id)) merged.unshift(m);
  return merged;
}

/** Read-modify-write for a single mission so parallel updates can't clobber the list. */
async function saveMission(mission: Mission): Promise<void> {
  const disk = await readDisk();
  const i = disk.findIndex((m) => m.id === mission.id);
  if (i >= 0) disk[i] = mission;
  else disk.unshift(mission);
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(disk.slice(0, MAX_KEPT), null, 2), "utf8");
}

export async function listMissions(): Promise<Mission[]> {
  return load();
}

let seq = 0;

interface MissionInput {
  title?: string;
  prompt: string;
  strategy: MissionStrategy;
  agentIds: string[];
  synthesizerId?: string;
}

async function createMission(input: MissionInput): Promise<Mission> {
  const mission: Mission = {
    id: `msn-${Date.now().toString(36)}-${seq++}`,
    title: input.title?.trim() || input.prompt.slice(0, 60),
    prompt: input.prompt,
    strategy: input.strategy,
    agentIds: input.agentIds,
    synthesizerId: input.strategy === "moa" ? input.synthesizerId : undefined,
    status: "running",
    createdAt: Date.now(),
    results: input.agentIds.map((agentId) => ({ agentId, status: "pending", text: "", ms: 0 })),
  };
  live.set(mission.id, mission);
  await saveMission(mission);
  return mission;
}

export async function startMission(input: MissionInput): Promise<Mission> {
  const mission = await createMission(input);
  void runMission(mission); // fire and forget — clients poll for progress
  return mission;
}

/** Like startMission, but resolves only when the mission has finished (used by the scheduler). */
export async function startMissionAwaited(input: MissionInput): Promise<Mission> {
  const mission = await createMission(input);
  await runMission(mission);
  return mission;
}

function synthesisPrompt(mission: Mission, answers: MissionResult[]): string {
  const blocks = answers
    .map((r) => `--- Answer from ${r.agentId} ---\n${r.text.trim()}`)
    .join("\n\n");
  return [
    `You are the synthesizer in a mixture-of-agents system. The user's task:`,
    mission.prompt,
    ``,
    `${answers.length} agents answered independently:`,
    ``,
    blocks,
    ``,
    `Synthesize the single best answer: merge their strengths, correct any errors, resolve disagreements. Output only the final answer — no meta-commentary about the agents.`,
  ].join("\n");
}

function pipelinePrompt(original: string, previous: string): string {
  return [
    `Task: ${original}`,
    ``,
    `A previous agent produced this attempt:`,
    `---`,
    previous.trim(),
    `---`,
    ``,
    `Improve and build on it. Fix errors, fill gaps, raise the quality. Output only the improved result.`,
  ].join("\n");
}

async function runMission(mission: Mission): Promise<void> {
  try {
    if (mission.strategy === "pipeline") {
      let current = "";
      for (const result of mission.results) {
        result.status = "running";
        await saveMission(mission);
        const input = current ? pipelinePrompt(mission.prompt, current) : mission.prompt;
        const r = await runAgentText(result.agentId, input);
        result.text = r.text;
        result.ms = r.ms;
        result.error = r.error;
        result.routedTo = r.routedTo;
        result.status = r.error ? "error" : "done";
        await saveMission(mission);
        if (!r.error && r.text.trim()) current = r.text;
      }
      mission.synthesis = current || undefined;
    } else {
      await Promise.all(
        mission.results.map(async (result) => {
          result.status = "running";
          await saveMission(mission);
          const r = await runAgentText(result.agentId, mission.prompt);
          result.text = r.text;
          result.ms = r.ms;
          result.error = r.error;
          result.routedTo = r.routedTo;
          result.status = r.error ? "error" : "done";
          await saveMission(mission);
        }),
      );

      if (mission.strategy === "moa" && mission.synthesizerId) {
        const good = mission.results.filter((r) => r.status === "done" && r.text.trim());
        if (good.length >= 2) {
          const r = await runAgentText(mission.synthesizerId, synthesisPrompt(mission, good), {
            injectMemory: false,
          });
          if (r.error) mission.synthesisError = r.error;
          else mission.synthesis = r.text;
        } else if (good.length === 1) {
          mission.synthesis = good[0].text;
        }
      }
    }

    const anyGood = mission.results.some((r) => r.status === "done");
    mission.status = anyGood ? "done" : "error";
  } catch (e) {
    mission.status = "error";
    mission.synthesisError = (e as Error).message;
  }

  mission.finishedAt = Date.now();
  try {
    mission.vaultFile = await writeMissionLog({
      title: mission.title,
      prompt: mission.prompt,
      strategy: mission.strategy,
      results: mission.results.map((r) => ({ agentId: r.agentId, text: r.text, error: r.error, ms: r.ms })),
      synthesis: mission.synthesis,
    });
  } catch {
    /* vault offline — mission result still lives in data/missions.json */
  }
  await saveMission(mission);
  live.delete(mission.id);
}
