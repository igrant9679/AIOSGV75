import fs from "fs/promises";
import path from "path";
import os from "os";
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
  conversations: ConvoMeta[];
  job: ImportJob;
}

const FILE = path.join(process.cwd(), "data", "llm-import.json");
const BATCH_SIZE = 12;
const CONDENSE_CHARS = 1600;
const JOB_STALE_MS = 5 * 60_000;

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

/** Parse every export file into full conversations (deduped by id). */
export async function parseAllConversations(): Promise<ImportedConversation[]> {
  const dir = exportsDir();
  await extractZips(dir);
  const files = await walkJson(dir);
  const byId = new Map<string, ImportedConversation>();
  for (const f of files) {
    const raw = await fs.readFile(f, "utf8").catch(() => "");
    if (!raw) continue;
    for (const c of parseRaw(raw)) {
      if (c.messages.length && !byId.has(c.id)) byId.set(c.id, c);
    }
  }
  return [...byId.values()];
}

function wordCount(c: ImportedConversation): number {
  return c.messages.reduce((n, m) => n + m.text.split(/\s+/).filter(Boolean).length, 0);
}

export async function scan(): Promise<ImportState> {
  await fs.mkdir(exportsDir(), { recursive: true }).catch(() => {});
  const all = await parseAllConversations();
  const prev = await readState();
  const processed = new Set(prev.conversations.filter((c) => c.processed).map((c) => c.id));
  const sources: Record<string, number> = {};
  const conversations: ConvoMeta[] = all.map((c) => {
    sources[c.source] = (sources[c.source] ?? 0) + 1;
    return {
      id: c.id,
      source: c.source,
      title: c.title,
      createdAt: c.createdAt,
      messageCount: c.messages.length,
      wordCount: wordCount(c),
      processed: processed.has(c.id),
    };
  });
  const state: ImportState = {
    scannedAt: Date.now(),
    exportsDir: exportsDir(),
    sources,
    conversations,
    job: prev.job.status === "running" ? prev.job : { ...EMPTY_JOB },
  };
  await writeState(state);
  return state;
}

// ─── distill ───
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

function distillPrompt(batch: ImportedConversation[], knownNotes: string[]): string {
  const blocks = batch.map((c, i) => `--- CONVERSATION ${i + 1} ---\n${condense(c)}`).join("\n\n");
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
  batch: ImportedConversation[],
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
  const all = await parseAllConversations();
  const processed = new Set(state.conversations.filter((c) => c.processed).map((c) => c.id));
  const remaining = all
    .filter((c) => !processed.has(c.id))
    .sort((a, b) => b.messages.length - a.messages.length);
  const todo = max > 0 ? remaining.slice(0, Math.min(max, 500)) : remaining;

  if (!todo.length) {
    state.job = { ...EMPTY_JOB, status: "done", note: "Nothing new to distill — all scanned conversations are already processed." };
    await writeState(state);
    return state;
  }

  state.job = { status: "running", processed: 0, total: todo.length, startedAt: Date.now(), heartbeat: Date.now() };
  await writeState(state);

  void (async () => {
    const batches = chunk(todo, BATCH_SIZE);
    const runStamp = `${todayStamp()} ${Date.now().toString(36).slice(-5)}`;
    // Snapshot the vault's note names once — the writer links topics into them.
    const knownNotes = await existingNoteNames();
    const written: { note: string; topics: string[]; tags: string[]; conversations: number }[] = [];
    let done = 0;
    for (let bi = 0; bi < batches.length; bi++) {
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
        s.job = { status: "running", processed: done, total: todo.length, startedAt: s.job.startedAt, heartbeat: Date.now() };
        await writeState(s);
      } catch (e) {
        // Salvage: index whatever landed before the failure, so completed work is linked.
        await writeHistoryIndex(written, runStamp).catch(() => {});
        const s = await readState();
        s.job = { ...s.job, status: "error", error: (e as Error).message, heartbeat: Date.now() };
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
      total: todo.length,
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
