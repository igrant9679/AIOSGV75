import { getServiceKey } from "./services";

/**
 * Web search via the Brave Search API — the fleet's only window onto anything
 * that happened after a model's training cutoff.
 *
 * Deliberately the same shape as the other credentialed services: the key comes
 * from the Settings store or BRAVE_API_KEY in .env.local, and nothing here runs
 * at all until one exists. Results are trimmed hard: this text is spliced into
 * a tool-call reply, so it competes with the conversation for context.
 */
export interface WebResult {
  title: string;
  url: string;
  description: string;
  age?: string;
}

const ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const TIMEOUT_MS = 12_000;

/** Brave returns descriptions with <strong> highlight markup around the query terms. */
function stripTags(s: string): string {
  return s
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

export async function isWebSearchReady(): Promise<boolean> {
  return Boolean(await getServiceKey("brave"));
}

export async function webSearch(query: string, count = 5): Promise<WebResult[]> {
  const key = await getServiceKey("brave");
  if (!key) throw new Error("no Brave API key — add one in Settings → Service Keys, or set BRAVE_API_KEY");

  const q = query.trim().slice(0, 400);
  if (!q) throw new Error("query is empty");

  const url = `${ENDPOINT}?q=${encodeURIComponent(q)}&count=${Math.min(Math.max(count, 1), 10)}`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      // Brave rejects requests without this header on some plans.
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": key,
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // 429 is the free tier's 1-query/second limit far more often than a quota wall.
    const hint = res.status === 429 ? " (rate limit — the free tier allows 1 query/second)" : "";
    throw new Error(`Brave search failed: ${res.status}${hint} ${body.slice(0, 200)}`.trim());
  }

  const json = (await res.json()) as { web?: { results?: unknown[] } };
  const raw = Array.isArray(json.web?.results) ? json.web!.results! : [];
  return raw.slice(0, count).map((r) => {
    const o = (r ?? {}) as Record<string, unknown>;
    return {
      title: stripTags(String(o.title ?? "")).slice(0, 200),
      url: String(o.url ?? ""),
      description: stripTags(String(o.description ?? "")).slice(0, 400),
      age: typeof o.age === "string" ? o.age : undefined,
    };
  });
}

/** Flatten results into the plain text a tool call hands back to a model. */
export function formatResults(results: WebResult[]): string {
  if (results.length === 0) return "no web results";
  return results
    .map((r, i) => `${i + 1}. ${r.title}${r.age ? ` (${r.age})` : ""}\n   ${r.url}\n   ${r.description}`)
    .join("\n");
}
