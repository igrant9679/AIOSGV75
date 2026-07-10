import fs from "fs/promises";
import path from "path";
import { vaultInfo } from "./vault";

/**
 * Vault-wide retrieval: chunks every markdown note in the Obsidian vault
 * (journals, chat logs, mission archives, the user's own notes) into passages
 * and ranks them against a query with a BM25-style keyword score. No external
 * embedding API — works fully offline and rebuilds at most every 2 minutes.
 */
export interface VaultPassage {
  file: string; // vault-relative path
  text: string;
  score: number;
  /** true when pulled in by following a [[wikilink]] from a scored passage */
  linked?: boolean;
}

interface IndexedPassage {
  file: string;
  text: string;
  terms: Set<string>;
}

const REBUILD_MS = 120_000;
const MAX_FILES = 800;
const MAX_FILE_BYTES = 200_000;
const MAX_PASSAGES = 6000;
const PASSAGE_CHARS = 600;
const SKIP_DIRS = new Set([".obsidian", ".trash", ".git"]);

const STOP = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "is", "it", "for", "on", "with",
  "that", "this", "as", "are", "was", "be", "by", "at", "from", "your", "my", "you",
  "what", "which", "who", "how", "when", "why", "can", "will", "would", "should", "not",
]);

function tokens(s: string): Set<string> {
  return new Set((s.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter((w) => !STOP.has(w)));
}

let index: {
  passages: IndexedPassage[];
  df: Map<string, number>;
  /** lowercase full path (no .md) and basename → first passage, for wikilink resolution */
  byName: Map<string, { file: string; text: string }>;
  builtAt: number;
} | null = null;
let building: Promise<void> | null = null;

export async function collectVaultFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const stack = [root];
  while (stack.length > 0 && out.length < MAX_FILES) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) stack.push(path.join(dir, e.name));
      } else if (e.name.endsWith(".md") && out.length < MAX_FILES) {
        out.push(path.join(dir, e.name));
      }
    }
  }
  return out;
}

function chunk(content: string): string[] {
  const paragraphs = content.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = "";
  for (const p of paragraphs) {
    const clean = p.trim();
    if (!clean) continue;
    if (current && current.length + clean.length > PASSAGE_CHARS) {
      chunks.push(current);
      current = clean.slice(0, PASSAGE_CHARS);
    } else {
      current = current ? `${current}\n${clean}` : clean.slice(0, PASSAGE_CHARS);
    }
  }
  if (current) chunks.push(current);
  return chunks.filter((c) => c.length >= 30);
}

async function buildIndex(): Promise<void> {
  const { root } = vaultInfo();
  const files = await collectVaultFiles(root);
  const passages: IndexedPassage[] = [];
  const df = new Map<string, number>();
  const byName = new Map<string, { file: string; text: string }>();

  for (const file of files) {
    if (passages.length >= MAX_PASSAGES) break;
    let content: string;
    try {
      const stat = await fs.stat(file);
      if (stat.size > MAX_FILE_BYTES) continue;
      content = await fs.readFile(file, "utf8");
    } catch {
      continue;
    }
    const rel = path.relative(root, file).replace(/\\/g, "/");
    let first = true;
    for (const text of chunk(content)) {
      if (passages.length >= MAX_PASSAGES) break;
      const terms = tokens(text);
      passages.push({ file: rel, text, terms });
      for (const t of terms) df.set(t, (df.get(t) ?? 0) + 1);
      if (first) {
        first = false;
        const noExt = rel.replace(/\.md$/i, "").toLowerCase();
        const base = path.basename(rel, ".md").toLowerCase();
        byName.set(noExt, { file: rel, text });
        if (!byName.has(base)) byName.set(base, { file: rel, text });
      }
    }
  }
  index = { passages, df, byName, builtAt: Date.now() };
}

const WIKILINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;

/** Follow [[wikilinks]] found in scored passages and pull in the linked notes. */
function expandLinks(hits: VaultPassage[], maxExtra: number): VaultPassage[] {
  if (!index || maxExtra <= 0) return hits;
  const seen = new Set(hits.map((h) => h.file.toLowerCase()));
  const extra: VaultPassage[] = [];
  for (const hit of hits) {
    if (extra.length >= maxExtra) break;
    for (const m of hit.text.matchAll(WIKILINK_RE)) {
      if (extra.length >= maxExtra) break;
      const target = m[1].trim().toLowerCase();
      const resolved = index.byName.get(target) ?? index.byName.get(path.basename(target));
      if (!resolved || seen.has(resolved.file.toLowerCase())) continue;
      seen.add(resolved.file.toLowerCase());
      extra.push({ file: resolved.file, text: resolved.text, score: 0, linked: true });
    }
  }
  return [...hits, ...extra];
}

async function ensureIndex(): Promise<void> {
  if (index && Date.now() - index.builtAt < REBUILD_MS) return;
  if (!building) {
    building = buildIndex().finally(() => {
      building = null;
    });
  }
  await building;
}

export async function searchVault(query: string, k = 3, followLinks = true): Promise<VaultPassage[]> {
  await ensureIndex();
  if (!index || index.passages.length === 0) return [];
  const q = tokens(query);
  if (q.size === 0) return [];
  const n = index.passages.length;

  const scored: VaultPassage[] = [];
  for (const p of index.passages) {
    let score = 0;
    for (const t of q) {
      if (p.terms.has(t)) score += Math.log(1 + n / (index.df.get(t) ?? 1));
    }
    if (score > 0) scored.push({ file: p.file, text: p.text, score });
  }
  const hits = scored.sort((a, b) => b.score - a.score).slice(0, k);
  // graph edges become context: linked notes ride along with the scored hits
  return followLinks ? expandLinks(hits, 2) : hits;
}
