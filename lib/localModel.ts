import { readRegistry, isLocalEndpoint } from "./registry";

/**
 * This machine's local model that is actually running right now, if any: a keyless local endpoint
 * in the registry whose /models list includes its model. With `pref` (a registry LLM's id, name or
 * model, ":latest" and case ignored) only that one counts. Asked, not assumed: with Ollama closed
 * a caller would otherwise lose a turn finding that out.
 *
 * Used by project runs (lib/runs.ts) and by the fallback when a plan hits its limit (lib/fallback.ts).
 */
export interface LocalModel {
  id: string;
  name: string;
  model: string;
}

export async function servedLocalModel(pref?: string): Promise<LocalModel | null> {
  const bare = (s: string) => s.toLowerCase().replace(/:latest$/, "");
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
    if (served.get(base)?.includes(bare(llm.model))) return { id: llm.id, name: llm.name, model: llm.model };
  }
  return null;
}
