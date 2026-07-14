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
    data = JSON.parse(raw);
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

function distillPrompt(batch: ImportedConversation[]): string {
  const blocks = batch.map((c, i) => `--- CONVERSATION ${i + 1} ---\n${condense(c)}`).join("\n\n");
  return [
    `You are distilling a person's exported AI chat history into durable knowledge notes for their "second brain". Below are ${batch.length} past conversations, condensed.`,
    ``,
    blocks,
    ``,
    `Write a concise Markdown digest of what is WORTH REMEMBERING from these conversations:`,
    `- Group related threads under "## " topic headings (invent clear topic names).`,
    `- Under each, 2–5 tight bullets: decisions reached, conclusions, preferences revealed, useful facts, or unfinished threads worth resuming.`,
    `- Ignore small talk, greetings, and one-off trivia. Be specific and factual — no filler, no "the user asked about…" narration.`,
    `- Finish with a "## Durable facts about the owner" section: bullets of stable preferences/context a future assistant should know.`,
    ``,
    `Output ONLY the Markdown digest.`,
  ].join("\n");
}

async function writeHistoryNote(batch: ImportedConversation[], digest: string, tag: string): Promise<void> {
  const dir = historyDir();
  await fs.mkdir(dir, { recursive: true });
  const titles = batch.map((c) => `- ${c.title} _(${c.source})_`).join("\n");
  const fm = ["---", "type: imported-history", `conversations: ${batch.length}`, `date: ${todayStamp()}`, "---", ""].join("\n");
  const body = `${digest.trim()}\n\n## Sources (${batch.length} conversations)\n${titles}\n`;
  await fs.writeFile(path.join(dir, `Imported History ${tag}.md`), fm + body, "utf8");
}

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/** Kick off a bounded, resumable distillation of up to `max` un-processed conversations. */
export async function startDistill(writer = "claude", max = 40): Promise<ImportState> {
  const state = await scan(); // refresh index first
  if (state.job.status === "running" && Date.now() - state.job.heartbeat < JOB_STALE_MS) {
    return state; // already running
  }
  const all = await parseAllConversations();
  const processed = new Set(state.conversations.filter((c) => c.processed).map((c) => c.id));
  const todo = all
    .filter((c) => !processed.has(c.id))
    .sort((a, b) => b.messages.length - a.messages.length)
    .slice(0, Math.max(1, Math.min(max, 500)));

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
    let done = 0;
    for (let bi = 0; bi < batches.length; bi++) {
      try {
        const r = await runAgentText(writer, distillPrompt(batches[bi]), { injectMemory: false });
        if (r.error) throw new Error(r.error);
        await writeHistoryNote(batches[bi], r.text, `${runStamp}-${bi + 1}`);
        const s = await readState();
        for (const c of batches[bi]) {
          const m = s.conversations.find((x) => x.id === c.id);
          if (m) m.processed = true;
        }
        done += batches[bi].length;
        s.job = { status: "running", processed: done, total: todo.length, startedAt: s.job.startedAt, heartbeat: Date.now() };
        await writeState(s);
      } catch (e) {
        const s = await readState();
        s.job = { ...s.job, status: "error", error: (e as Error).message, heartbeat: Date.now() };
        await writeState(s);
        return;
      }
    }
    const s = await readState();
    s.job = { status: "done", processed: done, total: todo.length, startedAt: s.job.startedAt, heartbeat: Date.now(), note: `Distilled ${done} conversations into Agentic OS/History/.` };
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
