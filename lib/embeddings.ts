import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

/**
 * Optional semantic layer for vault retrieval. Activates only when an
 * OpenAI-compatible embeddings endpoint is configured in .env.local:
 *   EMBED_BASE_URL=https://api.example.com/v1
 *   EMBED_API_KEY=sk-…
 *   EMBED_MODEL=text-embedding-3-small
 * Vectors are cached on disk; any failure quietly disables the layer for
 * 10 minutes and retrieval falls back to pure BM25.
 */
const BASE = process.env.EMBED_BASE_URL?.replace(/\/+$/, "");
const KEY = process.env.EMBED_API_KEY;
const MODEL = process.env.EMBED_MODEL;

const CACHE_FILE = path.join(process.cwd(), "data", "embeddings-cache.json");
const CACHE_MAX = 4000;
const DEAD_MS = 10 * 60_000;

let deadUntil = 0;
let cache: Record<string, number[]> | null = null;

export function embeddingsConfigured(): boolean {
  const localOk = BASE ? /^http:\/\/(localhost|127\.0\.0\.1)/i.test(BASE) : false;
  return Boolean(BASE && MODEL && (KEY || localOk)) && Date.now() > deadUntil;
}

function hash(text: string): string {
  return crypto.createHash("sha1").update(text).digest("hex");
}

async function loadCache(): Promise<Record<string, number[]>> {
  if (cache) return cache;
  try {
    cache = JSON.parse(await fs.readFile(CACHE_FILE, "utf8")) as Record<string, number[]>;
  } catch {
    cache = {};
  }
  return cache;
}

async function saveCache(): Promise<void> {
  if (!cache) return;
  const keys = Object.keys(cache);
  if (keys.length > CACHE_MAX) {
    for (const k of keys.slice(0, keys.length - CACHE_MAX)) delete cache[k];
  }
  await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
  await fs.writeFile(CACHE_FILE, JSON.stringify(cache), "utf8");
}

export async function embedTexts(texts: string[]): Promise<(number[] | null)[]> {
  if (!embeddingsConfigured()) return texts.map(() => null);
  const store = await loadCache();
  const results: (number[] | null)[] = texts.map((t) => store[hash(t)] ?? null);
  const missing = texts.map((t, i) => ({ t, i })).filter(({ i }) => results[i] === null);
  if (missing.length === 0) return results;

  try {
    const res = await fetch(`${BASE}/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(KEY ? { Authorization: `Bearer ${KEY}` } : {}) },
      body: JSON.stringify({ model: MODEL, input: missing.map(({ t }) => t.slice(0, 6000)) }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`embeddings ${res.status}`);
    const json = (await res.json()) as { data?: { index?: number; embedding?: number[] }[] };
    for (let j = 0; j < missing.length; j++) {
      const vec = json.data?.[j]?.embedding ?? json.data?.find((d) => d.index === j)?.embedding;
      if (Array.isArray(vec)) {
        results[missing[j].i] = vec;
        store[hash(missing[j].t)] = vec.map((v) => Math.round(v * 1e5) / 1e5);
      }
    }
    await saveCache();
  } catch {
    deadUntil = Date.now() + DEAD_MS;
    return texts.map(() => null);
  }
  return results;
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}
