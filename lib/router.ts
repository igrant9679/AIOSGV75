import { readRegistry, isLocalEndpoint } from "./registry";
import { listStandings } from "./arena";
import { readUsage, type UsageEntry } from "./usage";
import { hermesInstalled } from "./hermesSessions";
import { cliAvailable } from "./cliAvailable";

/**
 * The "Auto" agent's brain: classify the task, then pick the best real agent
 * using live signals — arena win-rates (quality), the usage ledger
 * (cost/latency/health), and provider cost hints as a prior.
 *
 * Cheapest first, dearer only when the task asks for it:
 *
 *   free          Hermes on a free Nous model, local models (Ollama)
 *   subscription  Codex on the ChatGPT plan — already paid for, quota-limited
 *   premium       Claude on the Claude plan — the strongest, and the scarcest quota
 *   metered       models added by API key — billed per token, so NOT in the pool
 *                 unless the owner opts each one in (LlmConfig.autoRoute)
 *
 * simple → cheapest · standard → a subscription tool · hard → the strongest.
 */
export interface RouteDecision {
  agentId: string;
  agentName: string;
  tier: "simple" | "standard" | "hard";
  reason: string;
}

/** Relative cost rank per provider (lower = cheaper), used until real data accumulates. */
const COST_RANK: Record<string, number> = {
  // Flat-rate subscription: a fixed quota that refreshes weekly, so an extra call
  // costs nothing at the margin. Cheapest thing to reach for — it's already paid.
  // (Distinct from `kimi` below, which is the pay-per-token Moonshot API.)
  "kimi-coding": 1,
  // Same shape: flat monthly plan, so an extra call costs nothing at the margin.
  // Quota-limited rather than unlimited (and GLM-5.2 burns 3x quota in the
  // 14:00-18:00 UTC+8 peak), so it's a good default agent but not a bulk worker.
  // Distinct from `glm` below, which is z.ai's METERED /api/paas/v4 endpoint.
  "glm-coding": 1,
  gemini: 1,
  deepseek: 2,
  glm: 3,
  kimi: 4,
  openrouter: 6,
  custom: 6,
  grok: 8,
  // Priciest thing in this fleet: $5/M in, $30/M out — above Claude Opus 4.8's $25
  // out and ~10x GLM 5.2. (Not the dearest model that exists — #16 of 257 on Nous,
  // where gpt-5.5-pro is $180/M out — just the dearest one you'd plug in here.)
  // Left at the `?? 6` default it reads as mid-priced and Auto picks it to save money.
  sakana: 10,
};
const CLAUDE_COST_RANK = 9;
/** Codex on the ChatGPT subscription: free at the margin like a flat plan, but it spends a weekly quota. */
const CODEX_COST_RANK = 4;
/** Costs nothing per call — ranks below every paid tier, including `gemini: 1`. */
const FREE_COST_RANK = 0;

/**
 * Cost rank for a registry LLM. The provider table above is only a *prior*: it
 * prices the vendor, not the specific model, and two cases make that prior wrong
 * in the same direction — both were falling through to the `?? 6` mid-tier
 * default, so Auto skipped genuinely-free agents in favour of paid ones, which
 * is precisely backwards for a cost heuristic.
 *
 *  - localhost endpoints (Ollama/LM Studio) run on this machine. Note `ollama`
 *    was never a key in the table at all, so local Llama scored 6.
 *  - a model id ending in `:free` is the provider's own free tier (OpenRouter
 *    and Nous both use this suffix). Keyed off the MODEL, not the provider, so
 *    switching that same agent to a paid model correctly re-prices it.
 *
 * Free tiers are rate-limited rather than unlimited, but a throttled agent is
 * already handled downstream by the okRate health filter.
 */
function costRankFor(llm: { provider: string; baseUrl: string; model: string }): number {
  if (isLocalEndpoint(llm.baseUrl)) return FREE_COST_RANK;
  if (/:free$/i.test((llm.model ?? "").trim())) return FREE_COST_RANK;
  return COST_RANK[llm.provider] ?? 6;
}

const HARD_HINTS =
  /\b(code|debug|refactor|implement|analy[sz]e|architect|design|prove|math|calculat|strateg|research|essay|compare|evaluate|optimi[sz]e|plan\b|write (a|an|the))\b/i;

export function classifyTier(prompt: string): RouteDecision["tier"] {
  const hard = HARD_HINTS.test(prompt);
  if (prompt.length < 80 && !hard) return "simple";
  if (hard || prompt.length > 400) return "hard";
  return "standard";
}

export type CostBand = "free" | "subscription" | "premium" | "metered";

/** Auto's own workers: a tool run a particular way, not an entry in the registry. See runAgentText. */
export const HERMES_FREE_ID = "hermes-free";
export const CODEX_CLI_ID = "codex-cli";

export interface Candidate {
  id: string;
  name: string;
  band: CostBand;
  costRank: number;
  winRate: number | null;
  battles: number;
  /** Recency-weighted success rate — see `healthFor`. Null = not enough evidence. */
  health: number | null;
}

/** Below this, an agent is benched. */
const HEALTH_FLOOR = 0.5;
/** A run's weight halves every 7 days, so current behaviour outvotes history. */
const HEALTH_HALF_LIFE_DAYS = 7;
/** Same-outcome runs this close together are one event, not independent samples. */
const INCIDENT_WINDOW_MS = 5 * 60_000;

/**
 * How reliable an agent looks *right now*, from the usage ledger.
 *
 * A flat average over the window had two failure modes that compounded badly.
 * On 2026-08-11 an expired Claude OAuth token failed 11 missions inside one
 * minute; the ledger counted that as 11 independent votes, when the number
 * really only recorded how many jobs happened to be in flight during a single
 * outage. And once auth was fixed, that month-old minute still outvoted every
 * healthy run since — the agent was provably working and provably benched.
 *
 * So: collapse same-outcome runs inside a 5-minute window into one incident,
 * then weight each incident by age with a 7-day half-life. An outage costs one
 * (decaying) vote, and one fresh success is enough to demonstrate recovery.
 */
export function healthFor(runs: UsageEntry[], now: number): number | null {
  const incidents = new Map<string, { ok: boolean; ts: number }>();
  for (const e of runs) {
    const key = `${e.ok ? 1 : 0}:${Math.floor(e.ts / INCIDENT_WINDOW_MS)}`;
    const seen = incidents.get(key);
    if (!seen || e.ts > seen.ts) incidents.set(key, { ok: Boolean(e.ok), ts: e.ts });
  }
  // One incident is an anecdote — the old rule wanted 2 runs, this wants 2 events.
  if (incidents.size < 2) return null;

  let okWeight = 0;
  let totalWeight = 0;
  for (const inc of incidents.values()) {
    const ageDays = Math.max(0, (now - inc.ts) / 86_400_000);
    const weight = Math.pow(0.5, ageDays / HEALTH_HALF_LIFE_DAYS);
    totalWeight += weight;
    if (inc.ok) okWeight += weight;
  }
  return totalWeight > 0 ? okWeight / totalWeight : null;
}

export interface RoutablePool {
  /** Everything Auto can reach: Claude plus every ready registry LLM. */
  candidates: Candidate[];
  /** What routing actually picks from, once the health filter has run. */
  pool: Candidate[];
  /** Candidates the health filter removed, each with the okRate that did it. */
  dropped: Candidate[];
  /** Every candidate failed the filter, so it was bypassed and `pool` = `candidates`. */
  degraded: boolean;
  /** Models added by API key that Auto is NOT using because the owner hasn't opted them in. */
  excluded: { id: string; name: string }[];
}

/**
 * The set of agents Auto will actually choose between, right now.
 *
 * Shared by `routeTask` and the `/api/auto` GET the UI reads, so the "N models
 * in pool" badge can never drift from the real thing — it used to count keyed
 * registry entries, which silently ignored both Claude and the health filter.
 */
export async function routablePool(): Promise<RoutablePool> {
  const [reg, standings, usage] = await Promise.all([readRegistry(), listStandings(), readUsage(30)]);

  const now = Date.now();
  const healthOf = (id: string): number | null => healthFor(usage.filter((e) => e.agent === id), now);
  const standingFor = (id: string) => standings.find((s) => s.agentId === id);

  // A keyed, remote model is billed by its provider: it joins the pool only when opted in.
  const eligible = reg.llms.filter((l) => isLocalEndpoint(l.baseUrl) || (l.apiKey && l.autoRoute === true));
  const excluded = reg.llms.filter((l) => l.apiKey && !isLocalEndpoint(l.baseUrl) && l.autoRoute !== true).map((l) => ({ id: l.id, name: l.name }));
  const own = (id: string, name: string, band: CostBand, costRank: number): Candidate => ({
    id,
    name,
    band,
    costRank,
    winRate: standingFor(id) ? standingFor(id)!.wins / Math.max(1, standingFor(id)!.battles) : null,
    battles: standingFor(id)?.battles ?? 0,
    health: healthOf(id),
  });

  const candidates: Candidate[] = [
    // Hermes on a free Nous model: costs nothing, and a signed-out Hermes is caught by the health filter
    ...(hermesInstalled() ? [own(HERMES_FREE_ID, "Hermes (free model)", "free", FREE_COST_RANK)] : []),
    // Codex on the ChatGPT plan: no per-call cost, but a weekly quota — dearer than free, cheaper than Claude
    ...(cliAvailable("codex") ? [own(CODEX_CLI_ID, "Codex", "subscription", CODEX_COST_RANK)] : []),
    {
      id: "claude",
      name: "Claude",
      band: "premium" as CostBand,
      costRank: CLAUDE_COST_RANK,
      winRate: standingFor("claude") ? standingFor("claude")!.wins / Math.max(1, standingFor("claude")!.battles) : null,
      battles: standingFor("claude")?.battles ?? 0,
      health: healthOf("claude"),
    },
    ...eligible
      .map((l) => ({
        id: l.id,
        name: l.name,
        band: (isLocalEndpoint(l.baseUrl) ? "free" : "metered") as CostBand,
        costRank: costRankFor(l),
        winRate: standingFor(l.id) ? standingFor(l.id)!.wins / Math.max(1, standingFor(l.id)!.battles) : null,
        battles: standingFor(l.id)?.battles ?? 0,
        health: healthOf(l.id),
      })),
  ];

  // drop anything that looks broken right now
  const healthy = candidates.filter((c) => c.health === null || c.health >= HEALTH_FLOOR);
  const degraded = healthy.length === 0;
  return {
    candidates,
    pool: degraded ? candidates : healthy,
    dropped: degraded ? [] : candidates.filter((c) => !healthy.includes(c)),
    degraded,
    excluded,
  };
}

export async function routeTask(prompt: string): Promise<RouteDecision> {
  const tier = classifyTier(prompt);
  const { pool } = await routablePool();

  const quality = (c: Candidate) => (c.battles > 0 && c.winRate !== null ? c.winRate : -1);

  let pick: Candidate;
  let why: string;
  if (tier === "simple") {
    pick = [...pool].sort((a, b) => a.costRank - b.costRank)[0];
    why = `simple task → cheapest ready model`;
  } else if (tier === "hard") {
    const ranked = [...pool].sort((a, b) => quality(b) - quality(a) || a.costRank - b.costRank);
    // No arena data: the strongest band that is available. Claude first; if Claude is benched or
    // absent, a subscription tool - never "cheapest", which is what sorting by cost alone gave.
    const strength: CostBand[] = ["premium", "subscription", "metered", "free"];
    const strongest = [...pool].sort((a, b) => strength.indexOf(a.band) - strength.indexOf(b.band) || b.costRank - a.costRank)[0];
    pick = ranked[0].battles > 0 ? ranked[0] : strongest;
    why =
      pick.battles > 0
        ? `hard task → best arena win-rate (${Math.round((pick.winRate ?? 0) * 100)}% of ${pick.battles})`
        : `hard task → strongest default (no arena data yet)`;
  } else {
    // standard: proven quality if any; else a subscription tool (paid for already, more able than
    // the free tier); else the premium one. Never the free tier by default — "cheapest" is for
    // simple tasks, and a standard task answered badly costs more than it saved.
    const proven = [...pool].filter((c) => c.battles > 0).sort((a, b) => quality(b) - quality(a));
    const byCost = [...pool].sort((a, b) => a.costRank - b.costRank);
    const subscription = byCost.find((c) => c.band === "subscription");
    const premium = byCost.find((c) => c.band === "premium");
    pick = proven[0] ?? subscription ?? premium ?? byCost[Math.floor((pool.length - 1) / 2)];
    why = proven[0]
      ? `standard task → proven performer (${Math.round((pick.winRate ?? 0) * 100)}% arena win-rate)`
      : subscription
        ? `standard task → ${pick.name}, on a subscription already paid for`
        : `standard task → balanced pick`;
  }

  return { agentId: pick.id, agentName: pick.name, tier, reason: why };
}
