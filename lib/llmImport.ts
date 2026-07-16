import fs from "fs/promises";
import { createReadStream } from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import { runAgentText } from "./runners";
import { vaultInfo, vaultAvailable, todayStamp } from "./vault";

/**
 * LLM History Import — ingest ChatGPT / Claude.ai data exports and distill them
 * into durable topic notes in the vault (Agentic OS/History/), so years of past
 * conversations become part of the shared brain (searchable + RAG'd).
 *
 * Two stages, deliberately separate so cost is opt-in:
 *   1. SCAN (free, local) — parse every exported conversations.json in the
 *      exports folder into a metadata index (data/llm-import.json).
 *   2. DISTILL (LLM, bounded) — the user picks a cap; the fleet condenses
 *      batches of the richest un-processed conversations into Markdown digests
 *      written to the vault. Resumable: processed ids are remembered.
 *
 * Raw exports and the index are per-machine (they live under the user's
 * Documents); only the distilled OUTPUT goes to the synced vault.
 */
const pexec = promisify(execFile);

export interface ImportedConversation {
  id: string;
  source: "chatgpt" | "claude";
  title: string;
  createdAt: number;
  messages: { role: "user" | "assistant"; text: string; ts: number }[];
}

export interface ConvoMeta {
  id: string;
  source: "chatgpt" | "claude";
  title: string;
  createdAt: number;
  messageCount: number;
  wordCount: number;
  processed: boolean;
  /** Content fingerprint — lets "already distilled" survive an id change. */
  fp?: string | null;
}

export interface ImportJob {
  status: "idle" | "running" | "done" | "error";
  processed: number;
  total: number;
  error?: string;
  note?: string;
  startedAt: number;
  heartbeat: number;
}

export interface ImportState {
  scannedAt: number;
  exportsDir: string;
  sources: Record<string, number>;
  /** Duplicate copies discarded by the last scan (id + content dedup). */
  duplicates?: number;
  /** Files the last scan could not read — surfaced so failures aren't silent. */
  warnings?: string[];
  conversations: ConvoMeta[];
  job: ImportJob;
}

const FILE = path.join(process.cwd(), "data", "llm-import.json");
const BATCH_SIZE = 12;
const CONDENSE_CHARS = 1600;
const JOB_STALE_MS = 5 * 60_000;

/**
 * Distilling a whole archive is ~200 writer calls. On a subscription that will
 * hit the plan's usage window long before it finishes, and a timeout is normal
 * for a slow local model — neither should throw away a multi-hour run. Batches
 * retry with backoff; only a persistent failure stops the job.
 */
const BATCH_RETRIES = 4;
const RETRY_BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Transient = worth waiting out (rate limit, quota window, timeout, socket blip). */
function isTransient(msg: string): boolean {
  return /rate.?limit|429|quota|usage limit|too many requests|overloaded|529|503|timeout|timed out|aborted|ECONNRESET|ETIMEDOUT|socket hang up/i.test(
    msg,
  );
}

export function exportsDir(): string {
  return process.env.LLM_EXPORTS_DIR || path.join(os.homedir(), "Documents", "llm-exports");
}
function historyDir(): string {
  return path.join(vaultInfo().base, "History");
}

const EMPTY_JOB: ImportJob = { status: "idle", processed: 0, total: 0, startedAt: 0, heartbeat: 0 };

export async function readState(): Promise<ImportState> {
  try {
    const raw = JSON.parse(await fs.readFile(FILE, "utf8")) as ImportState;
    return { ...raw, job: raw.job ?? EMPTY_JOB };
  } catch {
    return { scannedAt: 0, exportsDir: exportsDir(), sources: {}, conversations: [], job: { ...EMPTY_JOB } };
  }
}

async function writeState(state: ImportState): Promise<void> {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(state), "utf8");
}

// ─── parsing ───
function extractChatGptParts(content: unknown): string {
  const c = content as { content_type?: string; parts?: unknown[]; text?: string } | null;
  if (!c) return "";
  if (Array.isArray(c.parts)) {
    return c.parts.map((p) => (typeof p === "string" ? p : ((p as { text?: string })?.text ?? ""))).filter(Boolean).join("\n");
  }
  return typeof c.text === "string" ? c.text : "";
}

function hashId(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return `h${(h >>> 0).toString(36)}`;
}

function parseChatGpt(arr: Record<string, unknown>[]): ImportedConversation[] {
  return arr.map((c) => {
    const mapping = (c.mapping ?? {}) as Record<string, { message?: Record<string, unknown> }>;
    const messages = Object.values(mapping)
      .map((n) => n?.message)
      .filter((m): m is Record<string, unknown> => {
        const role = (m?.author as { role?: string })?.role;
        return Boolean(m) && (role === "user" || role === "assistant");
      })
      .map((m) => ({
        role: ((m.author as { role: string }).role === "user" ? "user" : "assistant") as "user" | "assistant",
        ts: typeof m.create_time === "number" ? Math.round(m.create_time * 1000) : 0,
        text: extractChatGptParts(m.content).trim(),
      }))
      .filter((m) => m.text)
      .sort((a, b) => a.ts - b.ts);
    const createdAt = typeof c.create_time === "number" ? Math.round(c.create_time * 1000) : 0;
    const title = (c.title as string) || "(untitled)";
    return { id: (c.id as string) || (c.conversation_id as string) || hashId(title + createdAt), source: "chatgpt" as const, title, createdAt, messages };
  });
}

function parseClaude(arr: Record<string, unknown>[]): ImportedConversation[] {
  return arr.map((c) => {
    const raw = (c.chat_messages ?? c.messages ?? []) as Record<string, unknown>[];
    const messages = raw
      .map((m) => {
        const sender = (m.sender as string) || (m.role as string);
        const blocks = Array.isArray(m.content) ? (m.content as { text?: string }[]).map((b) => b?.text ?? "").join("\n") : "";
        return {
          role: (sender === "human" || sender === "user" ? "user" : "assistant") as "user" | "assistant",
          ts: Date.parse((m.created_at as string) || "") || 0,
          text: ((m.text as string) || blocks || "").trim(),
        };
      })
      .filter((m) => m.text);
    const createdAt = Date.parse((c.created_at as string) || "") || 0;
    const title = (c.name as string) || (c.title as string) || "(untitled)";
    return { id: (c.uuid as string) || (c.id as string) || hashId(title + createdAt), source: "claude" as const, title, createdAt, messages };
  });
}

function parseRaw(raw: string): ImportedConversation[] {
  let data: unknown;
  try {
    // Strip a UTF-8 BOM — a hand-saved conversations.json (e.g. PowerShell's
    // default utf8 encoding) carries one and JSON.parse rejects it, which used
    // to silently scan as 0 conversations.
    data = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
  } catch {
    return [];
  }
  const arr = Array.isArray(data)
    ? (data as Record<string, unknown>[])
    : Array.isArray((data as { conversations?: unknown }).conversations)
      ? ((data as { conversations: Record<string, unknown>[] }).conversations)
      : null;
  if (!arr || !arr.length || typeof arr[0] !== "object") return [];
  if ("mapping" in arr[0]) return parseChatGpt(arr);
  if ("chat_messages" in arr[0] || "messages" in arr[0]) return parseClaude(arr);
  return [];
}

/**
 * Yield each top-level JSON object from a file as text, without ever holding
 * the whole file as a string.
 *
 * This exists because real Claude exports blow past V8's hard limit: a
 * conversations.json over ~512MB makes `fs.readFile(f, "utf8")` throw
 * ("Cannot create a string longer than 0x1fffffe8 characters"), so the file
 * could never be imported at all. We walk the stream tracking brace depth
 * (string-aware, escape-aware) and emit one conversation object at a time.
 *
 * Assumes a top-level ARRAY of objects — which is what both ChatGPT and Claude
 * emit. `rootIsArray()` gates that; anything else takes the whole-file path.
 */
async function* iterateTopLevelObjects(file: string): AsyncGenerator<string> {
  const stream = createReadStream(file, { encoding: "utf8", highWaterMark: 1 << 22 });
  let depth = 0;
  let inString = false;
  let escaped = false;
  let parts: string[] = [];
  let startIdx = -1;

  for await (const chunk of stream as AsyncIterable<string>) {
    startIdx = depth > 0 ? 0 : -1;
    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === "{") {
        if (depth === 0) startIdx = i;
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0 && startIdx >= 0) {
          parts.push(chunk.slice(startIdx, i + 1));
          yield parts.join("");
          parts = [];
          startIdx = -1;
        }
      }
    }
    if (depth > 0 && startIdx >= 0) parts.push(chunk.slice(startIdx));
  }
}

/** Peek the first non-whitespace byte to see if the root is a JSON array. */
async function rootIsArray(file: string): Promise<boolean> {
  const fh = await fs.open(file, "r").catch(() => null);
  if (!fh) return false;
  try {
    const { buffer, bytesRead } = await fh.read(Buffer.alloc(64), 0, 64, 0);
    const head = buffer.subarray(0, bytesRead).toString("utf8").replace(/^﻿/, "").trimStart();
    return head.startsWith("[");
  } finally {
    await fh.close();
  }
}

/** Parse one already-decoded conversation record with the right format parser. */
function parseOne(obj: Record<string, unknown>): ImportedConversation | null {
  if ("mapping" in obj) return parseChatGpt([obj])[0] ?? null;
  if ("chat_messages" in obj || "messages" in obj) return parseClaude([obj])[0] ?? null;
  return null;
}

/**
 * Walk every conversation in one export file, streaming when possible so file
 * size is irrelevant. Returns the number of records seen.
 */
async function forEachConversationInFile(
  file: string,
  onConvo: (c: ImportedConversation) => void,
): Promise<{ seen: number; error?: string }> {
  let seen = 0;
  if (await rootIsArray(file)) {
    try {
      for await (const objText of iterateTopLevelObjects(file)) {
        let obj: Record<string, unknown>;
        try {
          obj = JSON.parse(objText) as Record<string, unknown>;
        } catch {
          continue; // one malformed record shouldn't sink the file
        }
        const c = parseOne(obj);
        seen++;
        if (c && c.messages.length) onConvo(c);
      }
      return { seen };
    } catch (e) {
      return { seen, error: `${path.basename(file)}: ${(e as Error).message}` };
    }
  }
  // Non-array root (a wrapper object) — small in practice, read it whole.
  try {
    const raw = await fs.readFile(file, "utf8");
    const list = parseRaw(raw);
    seen = list.length;
    for (const c of list) if (c.messages.length) onConvo(c);
    return { seen };
  } catch (e) {
    return { seen, error: `${path.basename(file)}: ${(e as Error).message}` };
  }
}

async function walkJson(dir: string, acc: string[] = []): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walkJson(p, acc);
    else if (e.name.toLowerCase().endsWith(".json")) acc.push(p);
  }
  return acc;
}

/** Best-effort: unzip any *.zip exports in place (Windows) so the user can just drop the ZIP. */
async function extractZips(dir: string): Promise<void> {
  if (process.platform !== "win32") return;
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (!e.isFile() || !e.name.toLowerCase().endsWith(".zip")) continue;
    const zip = path.join(dir, e.name);
    const out = path.join(dir, e.name.replace(/\.zip$/i, "") + "-extracted");
    try {
      await fs.access(out);
      continue; // already extracted
    } catch {
      /* extract below */
    }
    try {
      await pexec(
        "powershell",
        ["-NoProfile", "-NonInteractive", "-Command", `Expand-Archive -LiteralPath ${JSON.stringify(zip)} -DestinationPath ${JSON.stringify(out)} -Force`],
        { timeout: 120_000 },
      );
    } catch {
      /* best effort — user can extract manually */
    }
  }
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Content fingerprint: a hash of the conversation's opening user message.
 * A re-export of the same chat — even under a different id, even after you
 * kept talking in it — opens identically, so the fingerprint matches.
 *
 * Returns null for very short openers ("hi", "thanks"), which would otherwise
 * collide across genuinely different conversations. Those fall back to id-only
 * dedup, which is the safe direction to fail.
 */
export function fingerprint(c: ImportedConversation): string | null {
  const opener = norm(c.messages.find((m) => m.role === "user")?.text ?? "");
  if (opener.length < 40) return null;
  return crypto.createHash("sha1").update(opener.slice(0, 800)).digest("hex").slice(0, 16);
}

/**
 * A scan-time record: metadata plus `head`, a short signature of the opening
 * messages used for the continuation check. Deliberately NOT the full
 * conversation — a real archive is hundreds of MB and holding every message in
 * memory would exhaust the heap. `head` is dropped before the index is saved.
 */
interface ScanRec extends ConvoMeta {
  head: string;
}

function headOf(c: ImportedConversation): string {
  return c.messages
    .slice(0, 3)
    .map((m) => norm(m.text).slice(0, 200))
    .join("|");
}

function metaOf(c: ImportedConversation): ScanRec {
  return {
    id: c.id,
    source: c.source,
    title: c.title,
    createdAt: c.createdAt,
    messageCount: c.messages.length,
    wordCount: wordCount(c),
    processed: false,
    fp: fingerprint(c),
    head: headOf(c),
  };
}

/** Richest wins: most messages, then most words. */
function richerRec(a: ScanRec, b: ScanRec): ScanRec {
  if (a.messageCount !== b.messageCount) return a.messageCount > b.messageCount ? a : b;
  return a.wordCount >= b.wordCount ? a : b;
}

export interface DedupResult {
  records: ScanRec[];
  duplicates: number; // copies discarded
  warnings: string[];
}

/**
 * Stream every export file and deduplicate in two passes:
 *   1. by id — the same conversation present in two overlapping exports
 *   2. by content fingerprint — the same conversation re-exported under a new
 *      id, verified as a true continuation (the `head` signature of one is a
 *      prefix of the other) so two different chats that merely share an opener
 *      are never merged.
 * In both passes the RICHEST copy survives, so re-exporting after months of
 * extra messages upgrades the record instead of keeping the stale one.
 *
 * Returns metadata only — see ScanRec.
 */
export async function scanRecords(): Promise<DedupResult> {
  const dir = exportsDir();
  await extractZips(dir);
  const files = await walkJson(dir);

  let seen = 0;
  const warnings: string[] = [];
  const byId = new Map<string, ScanRec>();
  for (const f of files) {
    const r = await forEachConversationInFile(f, (c) => {
      const rec = metaOf(c);
      const prev = byId.get(rec.id);
      byId.set(rec.id, prev ? richerRec(prev, rec) : rec);
    });
    seen += r.seen;
    if (r.error) warnings.push(r.error);
  }

  // pass 2 — content fingerprint
  const byFp = new Map<string, ScanRec>();
  const kept: ScanRec[] = [];
  for (const rec of byId.values()) {
    if (!rec.fp) {
      kept.push(rec); // too short to fingerprint safely — keep it
      continue;
    }
    const prev = byFp.get(rec.fp);
    if (!prev) {
      byFp.set(rec.fp, rec);
      continue;
    }
    // Same opener. Only merge if one genuinely continues the other.
    const [s, l] = prev.messageCount <= rec.messageCount ? [prev, rec] : [rec, prev];
    if (l.head.startsWith(s.head)) byFp.set(rec.fp, l);
    else kept.push(rec); // same opener, different conversation — keep both
  }

  const records = [...kept, ...byFp.values()];
  return { records, duplicates: Math.max(0, seen - records.length), warnings };
}

/**
 * Load the condensed text for a specific set of conversation ids. The distiller
 * only ever sends `condense()` output to the writer (~1.6KB per conversation),
 * so we never need to hold full message bodies — which is what makes importing
 * a 500MB+ archive possible at all.
 */
async function loadDistillDocs(ids: Set<string>): Promise<DistillDoc[]> {
  const files = await walkJson(exportsDir());
  const byId = new Map<string, { doc: DistillDoc; messages: number; words: number }>();
  for (const f of files) {
    await forEachConversationInFile(f, (c) => {
      if (!ids.has(c.id)) return;
      const prev = byId.get(c.id);
      const words = wordCount(c);
      // richest copy wins here too
      if (prev && (prev.messages > c.messages.length || (prev.messages === c.messages.length && prev.words >= words))) return;
      byId.set(c.id, {
        doc: { id: c.id, title: c.title, source: c.source, text: condense(c) },
        messages: c.messages.length,
        words,
      });
    });
  }
  return [...byId.values()].map((v) => v.doc);
}

function wordCount(c: ImportedConversation): number {
  return c.messages.reduce((n, m) => n + m.text.split(/\s+/).filter(Boolean).length, 0);
}

export async function scan(): Promise<ImportState> {
  await fs.mkdir(exportsDir(), { recursive: true }).catch(() => {});
  const { records, duplicates, warnings } = await scanRecords();
  const prev = await readState();
  // "Already distilled" is remembered by id AND by content fingerprint, so a
  // conversation re-exported under a new id is still recognised as done.
  const doneIds = new Set(prev.conversations.filter((c) => c.processed).map((c) => c.id));
  const doneFps = new Set(
    prev.conversations.filter((c) => c.processed && c.fp).map((c) => c.fp as string),
  );
  const sources: Record<string, number> = {};
  const conversations: ConvoMeta[] = records.map((r) => {
    sources[r.source] = (sources[r.source] ?? 0) + 1;
    const { head: _head, ...meta } = r; // `head` is scan-only, never persisted
    return { ...meta, processed: doneIds.has(r.id) || (r.fp ? doneFps.has(r.fp) : false) };
  });
  const state: ImportState = {
    scannedAt: Date.now(),
    exportsDir: exportsDir(),
    sources,
    duplicates,
    warnings,
    conversations,
    job: prev.job.status === "running" ? prev.job : { ...EMPTY_JOB },
  };
  await writeState(state);
  return state;
}

// ─── distill ───

/** What the writer actually needs: a condensed conversation, not its full text. */
export interface DistillDoc {
  id: string;
  title: string;
  source: string;
  text: string;
}

function condense(c: ImportedConversation): string {
  const lines = c.messages.map((m) => `${m.role === "user" ? "U" : "A"}: ${m.text.replace(/\s+/g, " ").trim()}`);
  let out = lines.join("\n");
  if (out.length > CONDENSE_CHARS) out = out.slice(0, CONDENSE_CHARS) + "…";
  return `TITLE: ${c.title} [${c.source}]\n${out}`;
}

/**
 * Existing vault note names, so the writer can [[wikilink]] a distilled topic
 * into the knowledge graph instead of orphaning it.
 *
 * Excluded, because linking to them is noise rather than signal: dated notes
 * (chat logs, journal entries), prior history notes, and the Agents/ hub pages
 * — a topic like "prefers local LLMs" would otherwise link to [[Claude]],
 * [[Llama]], and every other agent page, which tells a future reader nothing.
 */
async function existingNoteNames(limit = 160): Promise<string[]> {
  const { base } = vaultInfo();
  if (!base) return [];
  try {
    const { collectVaultFiles } = await import("./vaultSearch");
    const files = await collectVaultFiles(base);
    return files
      .filter((f) => !/(^|[\\/])Agents[\\/]/i.test(f) && !/(^|[\\/])Chats[\\/]/i.test(f))
      .map((f) => path.basename(f, ".md"))
      .filter((n) => !/^\d{4}-\d{2}-\d{2}/.test(n) && !n.startsWith("Imported History"))
      .slice(0, limit);
  } catch {
    return [];
  }
}

/**
 * Parse the writer's `TAGS:` trailer; fall back to nothing rather than guessing.
 * Split on COMMAS only — splitting on whitespace would shred a multi-word tag
 * ("Bad Tag" → "bad" + "tag") into junk. Multi-word tags are slugified instead.
 */
function splitTags(raw: string): { digest: string; tags: string[] } {
  const m = raw.match(/^\s*TAGS:\s*(.+)$/im);
  if (!m) return { digest: raw.trim(), tags: [] };
  const tags = [
    ...new Set(
      m[1]
        .split(",")
        .map((t) =>
          t
            .trim()
            .replace(/^#/, "")
            .toLowerCase()
            .replace(/[^a-z0-9/\s-]/g, "")
            .trim()
            .replace(/\s+/g, "-"),
        )
        .filter((t) => /^[a-z0-9][a-z0-9/-]{1,30}$/.test(t)),
    ),
  ].slice(0, 8);
  return { digest: raw.replace(m[0], "").trim(), tags };
}

function distillPrompt(batch: DistillDoc[], knownNotes: string[]): string {
  const blocks = batch.map((d, i) => `--- CONVERSATION ${i + 1} ---\n${d.text}`).join("\n\n");
  const linkable = knownNotes.length
    ? [
        ``,
        `EXISTING NOTES in the owner's vault (link to these with [[Note Name]] when a topic genuinely relates to one — exact names only, never invent a note name):`,
        knownNotes.map((n) => `[[${n}]]`).join(" · "),
      ].join("\n")
    : "";
  return [
    `You are distilling a person's exported AI chat history into durable knowledge notes for their "second brain". Below are ${batch.length} past conversations, condensed.`,
    ``,
    blocks,
    linkable,
    ``,
    `Write a concise Markdown digest of what is WORTH REMEMBERING from these conversations:`,
    `- Group related threads under "## " topic headings (invent clear topic names).`,
    `- Under each, 2–5 tight bullets: decisions reached, conclusions, preferences revealed, useful facts, or unfinished threads worth resuming.`,
    `- Ignore small talk, greetings, and one-off trivia. Be specific and factual — no filler, no "the user asked about…" narration.`,
    `- Where a topic relates to an EXISTING NOTE listed above, reference it inline as [[Note Name]] (exact name). Do not invent [[links]] to notes that don't exist.`,
    `- Finish with a "## Durable facts about the owner" section: bullets of stable preferences/context a future assistant should know.`,
    ``,
    `After the digest, output one final line, exactly:`,
    `TAGS: tag1, tag2, tag3`,
    `— 3–8 lowercase kebab-case topic tags covering the themes above (e.g. "ai-agents, seo, home-automation"). No "#", no spaces inside a tag.`,
    ``,
    `Output ONLY the Markdown digest followed by that TAGS line.`,
  ].join("\n");
}

async function writeHistoryNote(
  batch: DistillDoc[],
  raw: string,
  tag: string,
): Promise<{ tags: string[]; topics: string[] }> {
  const dir = historyDir();
  await fs.mkdir(dir, { recursive: true });
  const { digest, tags } = splitTags(raw);
  const topics = [...digest.matchAll(/^##\s+(.+)$/gm)]
    .map((m) => m[1].trim())
    .filter((t) => !/^durable facts/i.test(t) && !/^sources/i.test(t));

  const titles = batch.map((c) => `- ${c.title} _(${c.source})_`).join("\n");
  const fm = [
    "---",
    "type: imported-history",
    `conversations: ${batch.length}`,
    `date: ${todayStamp()}`,
    ...(tags.length ? [`tags: [${tags.join(", ")}]`] : []),
    "---",
    "",
  ].join("\n");
  const body = `${digest}\n\n## Sources (${batch.length} conversations)\n${titles}\n`;
  await fs.writeFile(path.join(dir, `Imported History ${tag}.md`), fm + body, "utf8");
  return { tags, topics };
}

/**
 * A hub note listing every distilled note by topic + tag, wikilinked. This is
 * what pulls the imported history into the knowledge graph as a cluster rather
 * than a pile of orphans.
 */
async function writeHistoryIndex(
  entries: { note: string; topics: string[]; tags: string[]; conversations: number }[],
  runStamp: string,
): Promise<void> {
  if (!entries.length) return;
  const dir = historyDir();
  const allTags = [...new Set(entries.flatMap((e) => e.tags))].sort();
  const lines = [
    "---",
    "type: imported-history-index",
    `date: ${todayStamp()}`,
    ...(allTags.length ? [`tags: [${allTags.join(", ")}]`] : []),
    "---",
    "",
    `# Imported History — ${runStamp}`,
    "",
    `Distilled from ${entries.reduce((s, e) => s + e.conversations, 0)} exported conversations across ${entries.length} note(s).`,
    "",
    ...entries.flatMap((e) => [
      `## [[${e.note}]]`,
      e.tags.length ? `Tags: ${e.tags.map((t) => `#${t}`).join(" ")}` : "",
      ...e.topics.map((t) => `- ${t}`),
      "",
    ]),
  ];
  await fs.writeFile(path.join(dir, `Imported History Index ${runStamp}.md`), lines.filter((l) => l !== undefined).join("\n"), "utf8");
}

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/**
 * Kick off a bounded, resumable distillation of up to `max` un-processed
 * conversations. `max <= 0` means EVERYTHING — no cap; the run just walks
 * every remaining conversation richest-first. Cost scales with the writer:
 * one call per batch of 12, so a 600-conversation archive is ~50 writer runs.
 */
export async function startDistill(writer = "claude", max = 40): Promise<ImportState> {
  const state = await scan(); // refresh index first
  if (state.job.status === "running" && Date.now() - state.job.heartbeat < JOB_STALE_MS) {
    return state; // already running
  }
  // Selection runs on the freshly-scanned METADATA (already deduped by id and
  // fingerprint), so nothing large is loaded just to decide what to distill.
  const remaining = state.conversations
    .filter((c) => !c.processed)
    .sort((a, b) => b.messageCount - a.messageCount);
  const picked = max > 0 ? remaining.slice(0, Math.min(max, 500)) : remaining;

  if (!picked.length) {
    state.job = { ...EMPTY_JOB, status: "done", note: "Nothing new to distill — all scanned conversations are already processed." };
    await writeState(state);
    return state;
  }

  state.job = { status: "running", processed: 0, total: picked.length, startedAt: Date.now(), heartbeat: Date.now() };
  await writeState(state);

  void (async () => {
    // Load ONLY the condensed text for the picked ids (~1.6KB each) — never the
    // full archive, which can be hundreds of MB.
    const docs = await loadDistillDocs(new Set(picked.map((c) => c.id)));
    const order = new Map(picked.map((c, i) => [c.id, i]));
    docs.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    const batches = chunk(docs, BATCH_SIZE);
    const runStamp = `${todayStamp()} ${Date.now().toString(36).slice(-5)}`;
    // Snapshot the vault's note names once — the writer links topics into them.
    const knownNotes = await existingNoteNames();
    const written: { note: string; topics: string[]; tags: string[]; conversations: number }[] = [];
    let done = 0;
    for (let bi = 0; bi < batches.length; bi++) {
      let lastErr = "";
      let ok = false;
      for (let attempt = 0; attempt <= BATCH_RETRIES && !ok; attempt++) {
        if (attempt > 0) {
          // Wait out a rate-limit window / transient failure, heartbeating so
          // the job isn't mistaken for dead while it sleeps.
          const wait = RETRY_BACKOFF_MS[Math.min(attempt - 1, RETRY_BACKOFF_MS.length - 1)];
          const until = Date.now() + wait;
          const s0 = await readState();
          s0.job = {
            ...s0.job,
            status: "running",
            heartbeat: Date.now(),
            note: `Paused ${Math.round(wait / 60_000)}m — writer unavailable (${lastErr.slice(0, 80)}). Retry ${attempt}/${BATCH_RETRIES}…`,
          };
          await writeState(s0);
          while (Date.now() < until) {
            await sleep(Math.min(30_000, until - Date.now()));
            const s1 = await readState();
            s1.job = { ...s1.job, heartbeat: Date.now() };
            await writeState(s1);
          }
        }
        try {
          const r = await runAgentText(writer, distillPrompt(batches[bi], knownNotes), { injectMemory: false });
          if (r.error) throw new Error(r.error);
          const noteTag = `${runStamp}-${bi + 1}`;
          const meta = await writeHistoryNote(batches[bi], r.text, noteTag);
          written.push({
            note: `Imported History ${noteTag}`,
            topics: meta.topics,
            tags: meta.tags,
            conversations: batches[bi].length,
          });
          const s = await readState();
          for (const c of batches[bi]) {
            const m = s.conversations.find((x) => x.id === c.id);
            if (m) m.processed = true;
          }
          done += batches[bi].length;
          s.job = {
            status: "running",
            processed: done,
            total: picked.length,
            startedAt: s.job.startedAt,
            heartbeat: Date.now(),
            note: undefined,
          };
          await writeState(s);
          ok = true;
        } catch (e) {
          lastErr = (e as Error).message;
          // A non-transient failure (bad writer id, vault gone) won't fix
          // itself — don't burn 50 minutes of backoff discovering that.
          if (!isTransient(lastErr)) break;
        }
      }
      if (!ok) {
        // Salvage: index whatever landed, so completed work is linked and the
        // run is resumable — processed flags for finished batches are saved.
        await writeHistoryIndex(written, runStamp).catch(() => {});
        const s = await readState();
        s.job = {
          ...s.job,
          status: "error",
          processed: done,
          error: `${lastErr} — stopped after ${done}/${picked.length}. Progress is saved: re-run Distill to continue.`,
          heartbeat: Date.now(),
        };
        await writeState(s);
        return;
      }
    }
    await writeHistoryIndex(written, runStamp).catch(() => {});
    const allTags = [...new Set(written.flatMap((w) => w.tags))];
    const s = await readState();
    s.job = {
      status: "done",
      processed: done,
      total: picked.length,
      startedAt: s.job.startedAt,
      heartbeat: Date.now(),
      note: `Distilled ${done} conversations into ${written.length} note(s) in Agentic OS/History/${allTags.length ? ` · tags: ${allTags.slice(0, 8).join(", ")}` : ""}.`,
    };
    await writeState(s);
  })();

  return state;
}

/** Clear processed flags (so a re-distill covers everything again). Vault notes are left in place. */
export async function resetProcessed(): Promise<ImportState> {
  const state = await readState();
  for (const c of state.conversations) c.processed = false;
  state.job = { ...EMPTY_JOB };
  await writeState(state);
  return state;
}

export async function importAvailable(): Promise<boolean> {
  return vaultAvailable();
}

/** Live job status with stale-run detection (a job dies with the server process). */
export function liveJob(job: ImportJob): ImportJob {
  if (job.status === "running" && Date.now() - job.heartbeat > JOB_STALE_MS) {
    return { ...job, status: "error", error: "interrupted (server restarted mid-run)" };
  }
  return job;
}
