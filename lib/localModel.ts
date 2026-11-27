import { readRegistry, isLocalEndpoint } from "./registry";
import { readLoad } from "./machineLoad";
import { MEM_FULL } from "./runPlacement";

/**
 * This machine's local model that is actually running right now, if any: a keyless local endpoint
 * in the registry whose /models list includes its model. With `pref` (a registry LLM's id, name or
 * model, ":latest" and case ignored) only that one counts. Asked, not assumed: with Ollama closed
 * a caller would otherwise lose a turn finding that out.
 *
 * Used by project runs (lib/runs.ts), "local" jobs from other machines (lib/sessionActions.ts), the
 * fallback when a plan hits its limit (lib/fallback.ts) and what this machine shares (lib/sessionShare.ts).
 */
export interface LocalModel {
  id: string;
  name: string;
  model: string;
  baseUrl: string;
}

const bare = (s: string) => s.toLowerCase().replace(/:latest$/, "");

export async function servedLocalModel(pref?: string): Promise<LocalModel | null> {
  const all = (await readRegistry()).llms.filter((l) => isLocalEndpoint(l.baseUrl) && !l.apiKey && l.model);
  const candidates = pref ? all.filter((l) => [l.id, l.name, l.model].some((v) => v && bare(v) === bare(pref))) : all;
  const served = new Map<string, string[] | null>(); // one /models call per endpoint
  for (const llm of candidates) {
    const base = llm.baseUrl.replace(/\/+$/, "");
    if (!served.has(base)) {
      try {
        const res = await fetch(`${base}/models`, { signal: AbortSignal.timeout(2500) });
        served.set(base, res.ok ? (((await res.json()) as { data?: { id?: string }[] }).data ?? []).map((m) => bare(String(m.id ?? ""))) : null);
      } catch {
        served.set(base, null);
      }
    }
    if (served.get(base)?.includes(bare(llm.model))) return { id: llm.id, name: llm.name, model: llm.model, baseUrl: base };
  }
  return null;
}

/**
 * Loading a local model takes about 1.4x its size in COMMITTED memory on Windows, even when Ollama
 * puts every layer on the GPU: measured on Raider18 2026-11-27, gpt-oss:20b (12.9 GB, all in VRAM)
 * took commit from 69% to 94% of 73 GB. Commit at its limit is how Mission Control and Ollama
 * crashed on 2026-11-25 (AGENTS.md rule 31), so a model is loaded only when commit stays below
 * MEM_FULL (93%) afterwards: 1.4x its size plus 7% of the commit limit must be free.
 */
export const LOAD_FACTOR = 1.4;

/** Ollama's own numbers for the model: its size on disk and whether it is loaded already. Unknown = undefined. */
async function ollamaFacts(lm: LocalModel): Promise<{ gb?: number; loaded?: boolean }> {
  const root = lm.baseUrl.replace(/\/v1$/, "");
  const get = async (p: string) => {
    try {
      const r = await fetch(`${root}${p}`, { signal: AbortSignal.timeout(2500) });
      return r.ok ? ((await r.json()) as { models?: { name?: string; model?: string; size?: number }[] }) : null;
    } catch {
      return null;
    }
  };
  const [tags, ps] = await Promise.all([get("/api/tags"), get("/api/ps")]);
  const same = (m: { name?: string; model?: string }) => [m.name, m.model].some((v) => v && bare(v) === bare(lm.model));
  const size = tags?.models?.find(same)?.size;
  return { gb: typeof size === "number" ? Math.round((size / 1024 ** 3) * 10) / 10 : undefined, loaded: ps ? !!ps.models?.some(same) : undefined };
}

/**
 * May this machine load (or use) the model now without running out of memory? Yes when it is loaded
 * already, or when commit would stay below MEM_FULL after loading it (this machine's own minute-old reading,
 * lib/machineLoad.ts). With no size or no reading it falls back to "commit below 85%".
 */
export async function localModelFits(lm: LocalModel): Promise<{ ok: boolean; why?: string; gb?: number }> {
  const f = await ollamaFacts(lm);
  if (f.loaded) return { ok: true, gb: f.gb };
  const load = readLoad();
  const used = load?.commitUsed ?? load?.memUsed;
  // Windows: the commit limit (RAM + page file). A Mac or Linux has no commit charge; there the
  // physical memory is what a model fills (on Apple Silicon the GPU shares it, too).
  const limit = load?.commitLimitGb ?? load?.memTotalGb;
  if (typeof used !== "number") return { ok: true, gb: f.gb }; // no reading: unknown is not "full" (rule 31)
  if (typeof f.gb === "number" && typeof limit === "number") {
    const free = Math.round((limit * (100 - used)) / 10) / 10;
    const need = Math.round((f.gb * LOAD_FACTOR + (limit * (100 - MEM_FULL)) / 100) * 10) / 10;
    return free >= need ? { ok: true, gb: f.gb } : { ok: false, gb: f.gb, why: `not enough free memory to load ${lm.model} (about ${need} GB needed, ${free} GB free)` };
  }
  return used < 85 ? { ok: true, gb: f.gb } : { ok: false, gb: f.gb, why: `memory ${used}% used` };
}
