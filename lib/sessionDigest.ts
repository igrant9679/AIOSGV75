import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import readline from "readline";
import { cleanPromptText, findSessionFile, readCodexText, textOf, type SessionSummary } from "./sessions";
import { launchSurface } from "./launchSurface";
import { vaultInfo } from "./vault";

/**
 * Conversation digests: the readable part of a Claude Code / Codex session —
 * your messages and the assistant's replies, WITHOUT tool calls or tool
 * output — written as Markdown notes in the vault:
 *
 *   Agentic OS/Sessions/<machine>/<YYYY-MM-DD> <title> <id8>.md
 *
 * Because they're ordinary vault notes, every machine sees them (OneDrive),
 * Obsidian shows them, the vault search on Projects finds them, and agents'
 * retrieval can pull them in as context. Likely secrets (API keys, tokens,
 * private keys, passwords in URLs) are redacted before anything is written.
 */

export interface Turn {
  role: "user" | "assistant";
  ts: number;
  text: string;
}

const MAX_TURN_CHARS = 6_000;
const MAX_DIGEST_CHARS = 60_000;

// ─── redaction ───

const SECRET_PATTERNS: [RegExp, string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[redacted private key]"],
  [/\bsk-(?:ant-|proj-|live-|test-)?[A-Za-z0-9_-]{20,}/g, "[redacted key]"],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/g, "[redacted GitHub token]"],
  [/\bgithub_pat_[A-Za-z0-9_]{40,}\b/g, "[redacted GitHub token]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "[redacted AWS key]"],
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, "[redacted Google key]"],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g, "[redacted Slack token]"],
  [/\b\d{8,10}:[A-Za-z0-9_-]{35}\b/g, "[redacted bot token]"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[redacted JWT]"],
  [/\b(Bearer)\s+[A-Za-z0-9._~+/=-]{20,}/gi, "$1 [redacted]"],
  [/\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+):[^\s@/]+@/gi, "$1:[redacted]@"],
  [/\b((?:api[_-]?key|secret|token|password|passwd|pwd)["']?\s*[:=]\s*["']?)[^\s"',;]{8,}/gi, "$1[redacted]"],
];

export function redactSecrets(text: string): string {
  let out = text;
  for (const [re, rep] of SECRET_PATTERNS) out = out.replace(re, rep);
  return out;
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.4);
  return `${text.slice(0, head)}\n\n… (${text.length - max} characters omitted) …\n\n${text.slice(text.length - (max - head))}`;
}

// ─── transcript readers ───

async function claudeTurns(file: string): Promise<Turn[]> {
  const turns: Turn[] = [];
  let reply: string[] = [];
  let replyTs = 0;
  const flush = () => {
    const text = reply.join("\n\n").trim();
    if (text) turns.push({ role: "assistant", ts: replyTs, text });
    reply = [];
  };
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line || !(line.includes('"type":"user"') || line.includes('"type":"assistant"'))) continue;
    if (line.includes('"toolUseResult"') || line.includes('"sourceToolAssistantUUID"')) continue;
    let o: { type?: string; isMeta?: boolean; isSidechain?: boolean; isCompactSummary?: boolean; timestamp?: string; message?: { content?: unknown } };
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (o.isSidechain || o.isMeta || o.isCompactSummary || !o.message) continue;
    const ts = o.timestamp ? Date.parse(o.timestamp) : 0;
    const content = o.message.content;
    if (o.type === "user") {
      if (Array.isArray(content) && content.some((c) => (c as { type?: string })?.type === "tool_result")) continue;
      const text = cleanPromptText(textOf(content));
      if (!text) continue;
      flush();
      turns.push({ role: "user", ts, text });
    } else if (o.type === "assistant" && Array.isArray(content)) {
      for (const c of content as { type?: string; text?: string }[]) {
        if (c?.type === "text" && c.text?.trim()) {
          reply.push(c.text.trim());
          replyTs = ts || replyTs;
        }
      }
    }
  }
  flush();
  return turns;
}

async function codexTurns(file: string): Promise<Turn[]> {
  const turns: Turn[] = [];
  for (const line of (await readCodexText(file)).split("\n")) {
    if (!line) continue;
    let o: { type?: string; timestamp?: string; payload?: { type?: string; role?: string; content?: unknown } };
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const p = o.payload;
    if (o.type !== "response_item" || p?.type !== "message") continue;
    const ts = o.timestamp ? Date.parse(o.timestamp) : 0;
    if (p.role === "user") {
      const text = cleanPromptText(textOf(p.content));
      if (text) turns.push({ role: "user", ts, text });
    } else if (p.role === "assistant") {
      const text = textOf(p.content).trim();
      if (!text) continue;
      const last = turns[turns.length - 1];
      if (last?.role === "assistant") last.text += `\n\n${text}`;
      else turns.push({ role: "assistant", ts, text });
    }
  }
  return turns;
}

export async function readTurns(file: string, tool: SessionSummary["tool"]): Promise<Turn[]> {
  return tool === "claude" ? claudeTurns(file) : codexTurns(file);
}

// ─── markdown ───

const when = (ts: number) => (ts ? new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

export function digestMarkdown(s: SessionSummary, turns: Turn[], machine: string): string {
  const toolName = s.tool === "claude" ? "Claude" : "Codex";
  const fm = [
    "---",
    `session: ${s.key}`,
    `tool: ${s.tool}`,
    `machine: ${JSON.stringify(machine)}`,
    `project: ${JSON.stringify(s.project)}`,
    s.folder || s.cwd ? `folder: ${JSON.stringify(s.folder || s.cwd)}` : "",
    `started: ${new Date(s.startedAt).toISOString()}`,
    `updated: ${new Date(s.updatedAt).toISOString()}`,
    `prompts: ${s.userTurns}`,
    "tags: [session-digest]",
    "---",
  ].filter(Boolean);
  const body: string[] = [
    `# ${s.title}`,
    "",
    `${toolName} session on **${machine}** · project **${s.project}** · ${when(s.startedAt)} → ${when(s.updatedAt)} · ${s.userTurns} prompts`,
    "",
    "> Your messages and the replies only — tool calls and their output are left out, and likely secrets are redacted. Written by Mission Control; edits here are overwritten.",
    "",
  ];
  const blocks = turns.map((t) => `### ${t.role === "user" ? "You" : toolName}${t.ts ? ` · ${when(t.ts)}` : ""}\n\n${clip(redactSecrets(t.text), MAX_TURN_CHARS)}`);
  // keep the opening and as much of the end as fits
  let total = 0;
  const head: string[] = [];
  const tail: string[] = [];
  for (const b of blocks.slice(0, 4)) {
    head.push(b);
    total += b.length;
  }
  for (let i = blocks.length - 1; i >= 4; i--) {
    if (total + blocks[i].length > MAX_DIGEST_CHARS) {
      tail.unshift(`*… ${i - 3} earlier messages omitted …*`);
      break;
    }
    tail.unshift(blocks[i]);
    total += blocks[i].length;
  }
  return `${fm.join("\n")}\n\n${[...body, ...head, ...tail].join("\n\n").replace(/\n{4,}/g, "\n\n\n")}\n`;
}

// ─── vault files ───

export function digestRoot(): string {
  return path.join(vaultInfo().base, "Sessions");
}

function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|#^[\]]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 70) || "Untitled";
}

const id8 = (s: SessionSummary) => s.id.replace(/-/g, "").slice(0, 8);

/** Existing digest for a session in a machine's folder (found by its id suffix, so renames don't duplicate). */
async function findDigest(dir: string, s: SessionSummary): Promise<string | undefined> {
  const names = await fsp.readdir(dir).catch(() => [] as string[]);
  const hit = names.find((n) => n.endsWith(` ${id8(s)}.md`));
  return hit ? path.join(dir, hit) : undefined;
}

/**
 * Write digests for this machine's sessions that changed since their last
 * digest. Newest first, time-boxed; Mission Control's own background runs
 * are skipped (their results are already saved to the vault as missions).
 */
export async function publishDigests(sessions: SessionSummary[], machine: string, budgetMs = 20_000): Promise<number> {
  const started = Date.now();
  const dir = path.join(digestRoot(), safeName(machine));
  await fsp.mkdir(dir, { recursive: true });
  let written = 0;
  const me = os.hostname();
  for (const s of sessions) {
    if (Date.now() - started > budgetMs || written >= 40) break;
    if (s.indexing || s.host !== me || s.userTurns < 1 || launchSurface(s.origin) === "background") continue;
    const existing = await findDigest(dir, s);
    if (existing) {
      const st = await fsp.stat(existing).catch(() => null);
      if (st && st.mtimeMs >= s.updatedAt) continue;
    }
    const file = await findSessionFile(s.key);
    if (!file) continue;
    try {
      const turns = await readTurns(file, s.tool);
      if (!turns.some((t) => t.role === "user")) continue;
      const md = digestMarkdown(s, turns, machine);
      const target = existing ?? path.join(dir, `${new Date(s.startedAt).toISOString().slice(0, 10)} ${safeName(s.title)} ${id8(s)}.md`);
      const tmp = `${target}.${process.pid}.tmp`;
      await fsp.writeFile(tmp, md, "utf8");
      await fsp.rename(tmp, target);
      written++;
    } catch {
      /* unreadable now — next pass */
    }
  }
  return written;
}

/**
 * A session's conversation as Markdown: built live from the session file when
 * it's on this machine, otherwise read from the digest its machine published.
 */
export async function conversationFor(s: SessionSummary, machineLabel: string): Promise<{ markdown: string; source: "local" | "vault" } | null> {
  if (s.host === os.hostname()) {
    const file = await findSessionFile(s.key);
    if (file) return { markdown: digestMarkdown(s, await readTurns(file, s.tool), machineLabel), source: "local" };
  }
  const machines = await fsp.readdir(digestRoot()).catch(() => [] as string[]);
  for (const m of machines) {
    const hit = await findDigest(path.join(digestRoot(), m), s);
    if (hit) return { markdown: await fsp.readFile(hit, "utf8"), source: "vault" };
  }
  return null;
}
