import { readUsage } from "./usage";
import { listStandings } from "./arena";
import { getEvalData } from "./evals";
import { listSchedules } from "./schedules";
import { listWatchers } from "./watchers";
import { readRegistry } from "./registry";

/**
 * Operations digest for the self-tuning review: everything the OS knows
 * about its own performance, as text an agent can reason over.
 * Available to any schedule via the {{ops_digest}} prompt variable.
 */
export async function opsDigest(): Promise<string> {
  const [usage, standings, evals, schedules, watchers, reg] = await Promise.all([
    readUsage(7),
    listStandings(),
    getEvalData(),
    listSchedules(),
    listWatchers(),
    readRegistry(),
  ]);

  const lines: string[] = ["=== OPS DIGEST (last 7 days) ==="];

  // usage per agent
  const byAgent = new Map<string, { runs: number; spend: number; ms: number; fails: number }>();
  for (const e of usage) {
    const a = byAgent.get(e.agent) ?? { runs: 0, spend: 0, ms: 0, fails: 0 };
    a.runs++;
    a.spend += e.costUsd ?? 0;
    a.ms += e.ms;
    if (!e.ok) a.fails++;
    byAgent.set(e.agent, a);
  }
  lines.push("", "USAGE:");
  if (byAgent.size === 0) lines.push("- no runs recorded this week");
  for (const [agent, a] of byAgent) {
    lines.push(
      `- ${agent}: ${a.runs} runs, $${a.spend.toFixed(2)}, avg ${(a.ms / a.runs / 1000).toFixed(1)}s, ${a.fails} failed`,
    );
  }

  lines.push("", "ARENA STANDINGS:");
  if (standings.length === 0) lines.push("- no battles judged yet");
  for (const s of standings) lines.push(`- ${s.agentId}: ${s.wins}/${s.battles} wins`);

  lines.push("", "LATEST EVAL RUN:");
  const lastRun = evals.runs.filter((r) => r.status === "done").at(-1);
  if (!lastRun) lines.push("- no eval runs yet");
  else {
    const byA = new Map<string, number[]>();
    for (const s of lastRun.scores) {
      if (s.score !== null) byA.set(s.agentId, [...(byA.get(s.agentId) ?? []), s.score]);
    }
    for (const [agent, scores] of byA) {
      lines.push(`- ${agent}: avg ${(scores.reduce((x, y) => x + y, 0) / scores.length).toFixed(1)}/10 over ${scores.length} cases`);
    }
  }

  lines.push("", "SCHEDULES:");
  if (schedules.length === 0) lines.push("- none");
  for (const s of schedules) {
    lines.push(`- "${s.title}" ${s.freq} ${s.freq !== "hourly" ? s.time : ""} [${s.enabled ? "on" : "off"}] last: ${s.lastStatus ?? "never ran"}`);
  }

  lines.push("", "WATCHERS:");
  if (watchers.length === 0) lines.push("- none");
  for (const w of watchers) {
    lines.push(`- "${w.name}" (${w.type}) [${w.enabled ? "on" : "off"}] last event: ${w.lastEvent ?? "none"}`);
  }

  lines.push("", "FLEET:");
  lines.push(`- claude (CLI) + LLMs: ${reg.llms.map((l) => `${l.name}${l.apiKey ? "" : " [NO KEY]"}`).join(", ") || "none"}`);
  lines.push(`- command agents: openclaw, hermes${reg.commandAgents.length ? ", " + reg.commandAgents.map((a) => a.name).join(", ") : ""}`);

  return lines.join("\n");
}
