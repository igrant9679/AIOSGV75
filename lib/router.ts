import { readRegistry } from "./registry";
import { listStandings } from "./arena";
import { readUsage } from "./usage";

/**
 * The "Auto" agent's brain: classify the task, then pick the best real agent
 * using live signals — arena win-rates (quality), the usage ledger
 * (cost/latency/health), and provider cost hints as a prior.
 */
export interface RouteDecision {
  agentId: string;
  agentName: string;
  tier: "simple" | "standard" | "hard";
  reason: string;
}

/** Relative cost rank per provider (lower = cheaper), used until real data accumulates. */
const COST_RANK: Record<string, number> = {
  gemini: 1,
  deepseek: 2,
  glm: 3,
  kimi: 4,
  openrouter: 6,
  custom: 6,
  grok: 8,
};
const CLAUDE_COST_RANK = 9;

const HARD_HINTS =
  /\b(code|debug|refactor|implement|analy[sz]e|architect|design|prove|math|calculat|strateg|research|essay|compare|evaluate|optimi[sz]e|plan\b|write (a|an|the))\b/i;

export function classifyTier(prompt: string): RouteDecision["tier"] {
  const hard = HARD_HINTS.test(prompt);
  if (prompt.length < 80 && !hard) return "simple";
  if (hard || prompt.length > 400) return "hard";
  return "standard";
}

export async function routeTask(prompt: string): Promise<RouteDecision> {
  const tier = classifyTier(prompt);
  const [reg, standings, usage] = await Promise.all([readRegistry(), listStandings(), readUsage(30)]);

  interface Candidate {
    id: string;
    name: string;
    costRank: number;
    winRate: number | null;
    battles: number;
    okRate: number | null;
  }

  const okRateFor = (id: string): number | null => {
    const runs = usage.filter((e) => e.agent === id);
    if (runs.length < 2) return null;
    return runs.filter((e) => e.ok).length / runs.length;
  };
  const standingFor = (id: string) => standings.find((s) => s.agentId === id);

  const candidates: Candidate[] = [
    {
      id: "claude",
      name: "Claude",
      costRank: CLAUDE_COST_RANK,
      winRate: standingFor("claude") ? standingFor("claude")!.wins / Math.max(1, standingFor("claude")!.battles) : null,
      battles: standingFor("claude")?.battles ?? 0,
      okRate: okRateFor("claude"),
    },
    ...reg.llms
      .filter((l) => l.apiKey)
      .map((l) => ({
        id: l.id,
        name: l.name,
        costRank: COST_RANK[l.provider] ?? 6,
        winRate: standingFor(l.id) ? standingFor(l.id)!.wins / Math.max(1, standingFor(l.id)!.battles) : null,
        battles: standingFor(l.id)?.battles ?? 0,
        okRate: okRateFor(l.id),
      })),
  ];

  // drop anything with a clearly bad track record
  const healthy = candidates.filter((c) => c.okRate === null || c.okRate >= 0.5);
  const pool = healthy.length > 0 ? healthy : candidates;

  const quality = (c: Candidate) => (c.battles > 0 && c.winRate !== null ? c.winRate : -1);

  let pick: Candidate;
  let why: string;
  if (tier === "simple") {
    pick = [...pool].sort((a, b) => a.costRank - b.costRank)[0];
    why = `simple task → cheapest ready model`;
  } else if (tier === "hard") {
    const ranked = [...pool].sort((a, b) => quality(b) - quality(a) || a.costRank - b.costRank);
    pick = ranked[0].battles > 0 ? ranked[0] : (pool.find((c) => c.id === "claude") ?? ranked[0]);
    why =
      pick.battles > 0
        ? `hard task → best arena win-rate (${Math.round((pick.winRate ?? 0) * 100)}% of ${pick.battles})`
        : `hard task → strongest default (no arena data yet)`;
  } else {
    // standard: proven quality if any, else mid-cost
    const proven = [...pool].filter((c) => c.battles > 0).sort((a, b) => quality(b) - quality(a));
    pick = proven[0] ?? [...pool].sort((a, b) => a.costRank - b.costRank)[Math.floor((pool.length - 1) / 2)];
    why = proven[0]
      ? `standard task → proven performer (${Math.round((pick.winRate ?? 0) * 100)}% arena win-rate)`
      : `standard task → balanced pick`;
  }

  return { agentId: pick.id, agentName: pick.name, tier, reason: why };
}
