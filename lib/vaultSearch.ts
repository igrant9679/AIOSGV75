import fs from "fs/promises";
import path from "path";
import { vaultInfo } from "./vault";

/**
 * Vault-wide retrieval: chunks every markdown note in the Obsidian vault
 * (journals, chat logs, mission archives, the user's own notes) into passages
 * and ranks them against a query with a BM25-style keyword score. No external
 * embedding API — works fully offline and rebuilds at most every 2 minutes.
 *
 * The index is BUDGETED PER FOLDER, newest notes first (see FOLDER_BUDGETS).
 * It used to fill in directory order until it hit one global cap; once session
 * digests reached ~38,000 passages the cap landed inside Sessions/ and
 * Missions, Journal, History, Chats, Daily Summaries and Agents contributed
 * nothing at all — search still returned results, just never from them.
 * Agentic OS/Archive is left out on purpose: the weekly roll-up notes in
 * Agentic OS/Weekly stand in for what was moved there (lib/rollup.ts).
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
// Raised from 800 when session digests and tool memory joined the vault (v43.5).
const MAX_FILES = 3000;
const MAX_FILE_BYTES = 200_000;
/** Backstop only — the per-folder budgets below are what normally bound the index. */
const MAX_PASSAGES = 9000;
const PASSAGE_CHARS = 600;
/** Files the index will look at (stat only; it reads far fewer). */
const MAX_INDEX_FILES = 25_000;

interface FolderBudget {
  /** most passages this folder may contribute */
  max: number;
  /** most passages one note may contribute */
  perFile: number;
  /** which passages of a long note to keep */
  pick: "head" | "tail" | "ends";
}

/**
 * Folders under "Agentic OS" that grow without limit get a fixed share. A long
 * session keeps its opening (the ask) and its end (the outcome); a mission log
 * keeps its end, because the first part is the prompt — which for scheduled
 * briefs is a multi-page digest of OTHER notes.
 */
const FOLDER_BUDGETS: Record<string, FolderBudget> = {
  Sessions: { max: 2000, perFile: 24, pick: "ends" },
  "Tool Memory": { max: 1200, perFile: 24, pick: "head" },
  History: { max: 700, perFile: 12, pick: "head" },
  Missions: { max: 800, perFile: 10, pick: "tail" },
};
/** Everything else under Agentic OS: Weekly, Journal, Chats, Agents, the Guide, … */
const DEFAULT_BUDGET: FolderBudget = { max: 700, perFile: 250, pick: "head" };
/** The user's own notes, outside Agentic OS (per top-level folder). */
const OWN_NOTES_BUDGET: FolderBudget = { max: 1500, perFile: 250, pick: "head" };
/** Filled last, so the backstop can never starve the small folders. */
const HEAVY_ORDER = ["Missions", "History", "Tool Memory", "Sessions"];
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

interface IndexFile {
  file: string;
  rel: string; // vault-relative, forward slashes
  mtime: number;
}

/** Budget group of a note: its folder under Agentic OS, or the user's own top-level folder. */
function groupOf(rel: string): string {
  const parts = rel.split("/");
  if (parts[0] !== "Agentic OS") return parts.length > 1 ? `~/${parts[0]}` : "~";
  return parts.length > 2 ? parts[1] : "(root)";
}

function budgetFor(group: string): FolderBudget {
  if (group.startsWith("~")) return OWN_NOTES_BUDGET;
  return FOLDER_BUDGETS[group] ?? DEFAULT_BUDGET;
}

/** Every markdown note with its mtime, minus Agentic OS/Archive. Cheap: stat only. */
async function collectIndexFiles(root: string): Promise<IndexFile[]> {
  const out: IndexFile[] = [];
  const archive = path.join(root, "Agentic OS", "Archive").toLowerCase();
  const stack = [root];
  while (stack.length > 0 && out.length < MAX_INDEX_FILES) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && full.toLowerCase() !== archive) stack.push(full);
      } else if (e.name.endsWith(".md") && out.length < MAX_INDEX_FILES) {
        const stat = await fs.stat(full).catch(() => null);
        if (!stat || stat.size > MAX_FILE_BYTES) continue;
        out.push({ file: full, rel: path.relative(root, full).replace(/\\/g, "/"), mtime: stat.mtimeMs });
      }
    }
  }
  return out;
}

function pickPassages(chunks: string[], b: FolderBudget): string[] {
  if (chunks.length <= b.perFile) return chunks;
  if (b.pick === "head") return chunks.slice(0, b.perFile);
  if (b.pick === "tail") return chunks.slice(-b.perFile);
  const head = Math.ceil(b.perFile / 3);
  return [...chunks.slice(0, head), ...chunks.slice(-(b.perFile - head))];
}

async function buildIndex(): Promise<void> {
  const { root } = vaultInfo();
  const files = await collectIndexFiles(root);
  const passages: IndexedPassage[] = [];
  const df = new Map<string, number>();
  const byName = new Map<string, { file: string; text: string }>();

  const groups = new Map<string, IndexFile[]>();
  for (const f of files) {
    const g = groupOf(f.rel);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(f);
  }
  const rank = (g: string) => HEAVY_ORDER.indexOf(g); // -1 for every small folder, so they go first
  const order = [...groups.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));

  for (const group of order) {
    const budget = budgetFor(group);
    let used = 0;
    // newest first: when a folder is over budget, it is the old notes that drop out
    for (const f of groups.get(group)!.sort((a, b) => b.mtime - a.mtime)) {
      if (used >= budget.max || passages.length >= MAX_PASSAGES) break;
      let content: string;
      try {
        content = await fs.readFile(f.file, "utf8");
      } catch {
        continue;
      }
      const all = chunk(content);
      if (all.length === 0) continue;
      // wikilinks resolve to a note's opening passage, whichever passages were kept
      const noExt = f.rel.replace(/\.md$/i, "").toLowerCase();
      const base = path.basename(f.rel, ".md").toLowerCase();
      byName.set(noExt, { file: f.rel, text: all[0] });
      if (!byName.has(base)) byName.set(base, { file: f.rel, text: all[0] });
      for (const text of pickPassages(all, budget)) {
        if (used >= budget.max || passages.length >= MAX_PASSAGES) break;
        const terms = tokens(text);
        passages.push({ file: f.rel, text, terms });
        for (const t of terms) df.set(t, (df.get(t) ?? 0) + 1);
        used++;
      }
    }
  }
  index = { passages, df, byName, builtAt: Date.now() };
}

/** What the index currently holds, per folder, so a blind spot shows up as a number and not a silence. */
export async function indexCoverage(): Promise<{ total: number; builtAt: number; folders: { folder: string; passages: number; notes: number }[] }> {
  await ensureIndex();
  const per = new Map<string, { passages: number; notes: Set<string> }>();
  for (const p of index?.passages ?? []) {
    const g = groupOf(p.file);
    if (!per.has(g)) per.set(g, { passages: 0, notes: new Set() });
    const e = per.get(g)!;
    e.passages++;
    e.notes.add(p.file);
  }
  const folders = [...per.entries()]
    .map(([folder, e]) => ({ folder, passages: e.passages, notes: e.notes.size }))
    .sort((a, b) => b.passages - a.passages);
  return { total: index?.passages.length ?? 0, builtAt: index?.builtAt ?? 0, folders };
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
  let ranked = scored.sort((a, b) => b.score - a.score);

  // hybrid rerank: when an embeddings endpoint is configured, blend BM25 with
  // semantic similarity over the lexical top candidates
  const { embeddingsConfigured, embedTexts, cosine } = await import("./embeddings");
  if (embeddingsConfigured() && ranked.length > 1) {
    const pool = ranked.slice(0, Math.max(k * 6, 18));
    const vectors = await embedTexts([query, ...pool.map((p) => p.text)]);
    const qv = vectors[0];
    if (qv) {
      const maxBm25 = pool[0].score || 1;
      ranked = pool
        .map((p, i) => {
          const pv = vectors[i + 1];
          const semantic = pv ? (cosine(qv, pv) + 1) / 2 : 0;
          return { ...p, score: 0.55 * (p.score / maxBm25) + 0.45 * semantic };
        })
        .sort((a, b) => b.score - a.score);
    }
  }

  const hits = ranked.slice(0, k);
  // graph edges become context: linked notes ride along with the scored hits
  return followLinks ? expandLinks(hits, 2) : hits;
}
