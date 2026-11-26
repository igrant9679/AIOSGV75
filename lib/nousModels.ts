import fsp from "fs/promises";
import path from "path";

/**
 * Which Nous Portal model a Hermes run should use — cheapest first.
 *
 * Nous Portal is one sign-in to hundreds of vendors' models at very different
 * prices, and Hermes's own default can be anything (it was a $0.91 / $2.86 per
 * million model when this was written). A run that only needs to summarise a
 * note should not inherit that. So Mission Control picks the model itself:
 *
 *   routine work, no internet  → the free model
 *   routine work, needs the web → the cheapest model that can use tools
 *                                 (Hermes reaches the web through tool calls)
 *
 * The price list is Nous's own public catalogue (no sign-in, no credentials):
 * https://inference-api.nousresearch.com/v1/models. It is cached in
 * data/nous-models.json — a derived cache, safe to delete — and refreshed twice
 * a day; if a refresh fails the last good copy keeps being used.
 *
 * The owner can pin either choice in data/worker-models.json:
 *   { "routine": "<model id>", "web": "<model id>", "avoid": ["<model id>", …], "local": false }
 * `avoid` is also where a model that turned out not to work gets parked.
 */

export interface NousModel {
  id: string;
  name: string;
  /** USD per million tokens */
  priceIn: number;
  priceOut: number;
  free: boolean;
  /** can make tool calls — without this Hermes has no web access on the model */
  tools: boolean;
  context: number;
}

const CATALOG_URL = "https://inference-api.nousresearch.com/v1/models";
const CACHE = path.join(process.cwd(), "data", "nous-models.json");
const SETTINGS = path.join(process.cwd(), "data", "worker-models.json");
const REFRESH_MS = 12 * 60 * 60 * 1000;

interface CacheFile {
  fetchedAt: number;
  models: NousModel[];
}

export interface WorkerModelSettings {
  routine?: string;
  web?: string;
  avoid?: string[];
  /** false = project runs never hand a task to this machine's local model (lib/runs.ts) */
  local?: boolean;
  /**
   * Multiplies every run worker's time budget (lib/runs.ts TIME_BUDGET_MS), 0.05 to 3. For testing
   * what happens when a worker runs out of time without waiting 19 minutes; unset = 1.
   */
  budgetScale?: number;
}

const MODEL_ID_RE = /^[\w.:~/-]{1,120}$/;
export const isModelId = (v: unknown): v is string => typeof v === "string" && MODEL_ID_RE.test(v);

function parseCatalog(body: unknown): NousModel[] {
  const data = (body as { data?: unknown[] })?.data;
  if (!Array.isArray(data)) return [];
  const out: NousModel[] = [];
  for (const raw of data) {
    const m = raw as {
      id?: string;
      name?: string;
      context_length?: number;
      pricing?: { prompt?: string; completion?: string };
      supported_parameters?: string[];
      architecture?: { output_modalities?: string[] };
    };
    if (!isModelId(m.id)) continue;
    if (m.architecture?.output_modalities && !m.architecture.output_modalities.includes("text")) continue;
    const priceIn = Number(m.pricing?.prompt) * 1e6;
    const priceOut = Number(m.pricing?.completion) * 1e6;
    if (!Number.isFinite(priceIn) || !Number.isFinite(priceOut) || priceIn < 0 || priceOut < 0) continue;
    out.push({
      id: m.id,
      name: (m.name ?? m.id).slice(0, 80),
      priceIn,
      priceOut,
      free: priceIn === 0 && priceOut === 0,
      tools: Array.isArray(m.supported_parameters) && m.supported_parameters.includes("tools"),
      context: Number(m.context_length) || 0,
    });
  }
  return out;
}

let refreshing: Promise<NousModel[]> | null = null;

async function readCache(): Promise<CacheFile | null> {
  try {
    const j = JSON.parse(await fsp.readFile(CACHE, "utf8")) as CacheFile;
    return Array.isArray(j.models) && j.models.length > 0 ? j : null;
  } catch {
    return null;
  }
}

/** The catalogue, refreshed when stale. Never throws: an empty list means "no data, use Hermes's own default". */
export async function nousCatalog(): Promise<NousModel[]> {
  const cached = await readCache();
  if (cached && Date.now() - cached.fetchedAt < REFRESH_MS) return cached.models;
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const res = await fetch(CATALOG_URL, { signal: AbortSignal.timeout(15_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const models = parseCatalog(await res.json());
        // An empty or tiny list is a broken response, not a real catalogue — keep the last good one.
        if (models.length < 10) throw new Error("catalogue looked empty");
        await fsp.mkdir(path.dirname(CACHE), { recursive: true });
        const file: CacheFile = { fetchedAt: Date.now(), models };
        const tmp = `${CACHE}.${process.pid}.tmp`;
        await fsp.writeFile(tmp, JSON.stringify(file), "utf8");
        await fsp.rename(tmp, CACHE);
        return models;
      } catch {
        return cached?.models ?? [];
      }
    })().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

export async function readWorkerModelSettings(): Promise<WorkerModelSettings> {
  try {
    const j = JSON.parse(await fsp.readFile(SETTINGS, "utf8")) as WorkerModelSettings;
    return {
      routine: isModelId(j.routine) ? j.routine : undefined,
      web: isModelId(j.web) ? j.web : undefined,
      avoid: Array.isArray(j.avoid) ? j.avoid.filter(isModelId) : [],
      local: j.local === false ? false : undefined,
      budgetScale: typeof j.budgetScale === "number" && j.budgetScale >= 0.05 && j.budgetScale <= 3 ? j.budgetScale : undefined,
    };
  } catch {
    return { avoid: [] };
  }
}

/** A blended price for ordering: output tokens dominate real cost, so they weigh three times as much. */
const blended = (m: NousModel) => m.priceIn + m.priceOut * 3;

export interface HermesModelChoice {
  /** undefined = no catalogue and nothing pinned: let Hermes use its own default, and say so */
  model?: string;
  free: boolean;
  why: string;
  /** what to try next if this one fails (rate limit, model withdrawn): the next-cheapest that fits */
  fallbacks: string[];
}

/**
 * Cheapest model for a Hermes run.
 *  - no web needed: a free model (free tiers are rate-limited, so the others follow as fallbacks,
 *    then the cheapest paid ones)
 *  - web needed: the cheapest model that can make tool calls. A free model qualifies only if it
 *    supports tools; `avoid` removes any that proved unable to finish a search.
 */
export async function pickHermesModel(opts: { needsWeb: boolean }): Promise<HermesModelChoice> {
  const [catalog, settings] = await Promise.all([nousCatalog(), readWorkerModelSettings()]);
  const avoid = new Set(settings.avoid ?? []);
  const usable = catalog.filter((m) => !avoid.has(m.id) && !/:batch$/i.test(m.id)); // batch endpoints answer hours later
  const pinned = opts.needsWeb ? settings.web : settings.routine;

  const pool = usable.filter((m) => (opts.needsWeb ? m.tools : true));
  // free first; among free, bigger context; among paid, cheaper
  const ranked = [...pool].sort((a, b) => Number(b.free) - Number(a.free) || (a.free ? b.context - a.context : blended(a) - blended(b)) || a.id.localeCompare(b.id));

  if (pinned) {
    return { model: pinned, free: /:free$/i.test(pinned), why: `pinned in data/worker-models.json`, fallbacks: ranked.filter((m) => m.id !== pinned).slice(0, 3).map((m) => m.id) };
  }
  const first = ranked[0];
  if (!first) {
    return { model: undefined, free: false, why: "no Nous price list available - Hermes will use its own default model", fallbacks: [] };
  }
  const price = first.free ? "free" : `$${first.priceIn.toFixed(2)} / $${first.priceOut.toFixed(2)} per million tokens`;
  return {
    model: first.id,
    free: first.free,
    why: opts.needsWeb ? `cheapest Nous model that can use the web (${price})` : `cheapest Nous model (${price})`,
    fallbacks: ranked.slice(1, 4).map((m) => m.id),
  };
}

/**
 * Does this task need the internet? A judgement call made from the words of the
 * task — the planner's explicit flag wins when there is one (lib/runs.ts).
 * Errs towards "yes": a web-capable model costs fractions of a cent, a routine
 * model that invents today's news costs a wrong answer.
 */
const WEB_HINTS =
  /\b(https?:\/\/|www\.|search (the )?(web|internet|online)|look ?up|google|browse|website|web ?page|url|link to|latest|current(ly)?|today|tonight|yesterday|this (week|month|year)|right now|news|headline|price of|stock|weather|forecast|release notes?|changelog|documentation for|docs for|who (is|won)|what happened|as of 20\d\d|recent(ly)?)\b/i;

export function needsWeb(task: string): boolean {
  return WEB_HINTS.test(task);
}
