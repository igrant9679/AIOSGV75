import fs from "fs";
import readline from "readline";
import { cleanPromptText, findSessionFile, readCodexText, textOf, type SessionSummary } from "./sessions";
import { redactSecrets } from "./sessionDigest";

/**
 * The COMPLETE thread of a Claude Code / Codex session, for the Projects page:
 * every message and reply, every tool call with its input, and every tool
 * result. Unlike the conversation digest (lib/sessionDigest.ts), nothing is
 * left out — long inputs/outputs are clipped, and likely secrets redacted.
 * Read live from the session file on the machine that owns it.
 */

export type ThreadEntry =
  | { kind: "user"; ts: number; text: string }
  | { kind: "assistant"; ts: number; text: string }
  | { kind: "tool"; ts: number; id: string; name: string; summary: string; input: string; output?: string; isError?: boolean }
  | { kind: "note"; ts: number; text: string };

export interface Thread {
  key: string;
  entries: ThreadEntry[];
  /** entries in the whole session; `entries` is the newest `limit` of them unless `all` */
  total: number;
  truncated: boolean;
}

const MAX_TEXT = 20_000;
const MAX_TOOL_IN = 4_000;
const MAX_TOOL_OUT = 6_000;

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.6);
  return `${text.slice(0, head)}\n… (${text.length - max} characters omitted) …\n${text.slice(text.length - (max - head))}`;
}

const tidy = (s: string, max: number) => clip(redactSecrets(s), max);

/** One-line description of a tool call, e.g. `Bash: npm run build` or `Edit: lib/foo.ts`. */
function summarize(name: string, input: unknown): string {
  const i = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const pick = (...ks: string[]) => {
    for (const k of ks) if (typeof i[k] === "string" && (i[k] as string).trim()) return (i[k] as string).trim();
    return "";
  };
  let detail = pick("command", "cmd", "file_path", "path", "pattern", "url", "query", "description", "prompt", "skill");
  if (!detail && Array.isArray(i.command)) detail = (i.command as unknown[]).join(" ");
  if (!detail && typeof input === "string") detail = input;
  detail = detail.replace(/\s+/g, " ");
  return detail ? `${name}: ${detail.slice(0, 160)}` : name;
}

function stringify(v: unknown): string {
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        const o = c as { type?: string; text?: string };
        // Claude: {type:"text"}; Codex: {type:"input_text"} / {type:"output_text"}
        if (typeof o?.text === "string") return o.text;
        if (o?.type === "image" || o?.type === "input_image") return "[image]";
        return stringify(c);
      })
      .join("\n");
  }
  return stringify(content);
}

async function claudeThread(file: string): Promise<ThreadEntry[]> {
  const out: ThreadEntry[] = [];
  const tools = new Map<string, Extract<ThreadEntry, { kind: "tool" }>>();
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line || !(line.includes('"type":"user"') || line.includes('"type":"assistant"') || line.includes('"type":"system"'))) continue;
    let o: {
      type?: string;
      subtype?: string;
      content?: string;
      isMeta?: boolean;
      isSidechain?: boolean;
      isCompactSummary?: boolean;
      timestamp?: string;
      message?: { content?: unknown };
    };
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (o.isSidechain) continue; // subagent chatter: its result comes back as the Task tool's output
    const ts = o.timestamp ? Date.parse(o.timestamp) : 0;
    if (o.type === "system") {
      if (o.subtype === "compact_boundary") out.push({ kind: "note", ts, text: "Conversation compacted (earlier context summarized)" });
      continue;
    }
    if (o.isCompactSummary) {
      out.push({ kind: "note", ts, text: "Summary of the earlier conversation was loaded" });
      continue;
    }
    if (o.isMeta || !o.message) continue;
    const content = o.message.content;
    if (o.type === "user") {
      if (Array.isArray(content) && content.some((c) => (c as { type?: string })?.type === "tool_result")) {
        for (const c of content as { type?: string; tool_use_id?: string; content?: unknown; is_error?: boolean }[]) {
          if (c?.type !== "tool_result") continue;
          const t = c.tool_use_id ? tools.get(c.tool_use_id) : undefined;
          const text = tidy(resultText(c.content), MAX_TOOL_OUT);
          if (t) {
            t.output = text;
            t.isError = Boolean(c.is_error);
          }
        }
        continue;
      }
      const text = cleanPromptText(textOf(content));
      if (text) out.push({ kind: "user", ts, text: tidy(text, MAX_TEXT) });
    } else if (o.type === "assistant" && Array.isArray(content)) {
      for (const c of content as { type?: string; text?: string; id?: string; name?: string; input?: unknown }[]) {
        if (c?.type === "text" && c.text?.trim()) {
          const last = out[out.length - 1];
          // the model streams one reply as several records - keep it one bubble
          if (last?.kind === "assistant") last.text = tidy(`${last.text}\n\n${c.text.trim()}`, MAX_TEXT);
          else out.push({ kind: "assistant", ts, text: tidy(c.text.trim(), MAX_TEXT) });
        } else if (c?.type === "tool_use" && c.name) {
          const t: Extract<ThreadEntry, { kind: "tool" }> = {
            kind: "tool",
            ts,
            id: c.id ?? `${ts}-${out.length}`,
            name: c.name,
            summary: redactSecrets(summarize(c.name, c.input)),
            input: tidy(stringify(c.input ?? {}), MAX_TOOL_IN),
          };
          if (c.id) tools.set(c.id, t);
          out.push(t);
        }
      }
    }
  }
  return out;
}

async function codexThread(file: string): Promise<ThreadEntry[]> {
  const out: ThreadEntry[] = [];
  const tools = new Map<string, Extract<ThreadEntry, { kind: "tool" }>>();
  for (const line of (await readCodexText(file)).split("\n")) {
    if (!line) continue;
    let o: {
      type?: string;
      timestamp?: string;
      payload?: { type?: string; role?: string; content?: unknown; name?: string; arguments?: string; input?: string; call_id?: string; output?: unknown; action?: unknown };
    };
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const p = o.payload;
    if (o.type !== "response_item" || !p) continue;
    const ts = o.timestamp ? Date.parse(o.timestamp) : 0;
    if (p.type === "message") {
      if (p.role === "user") {
        const text = cleanPromptText(textOf(p.content));
        if (text) out.push({ kind: "user", ts, text: tidy(text, MAX_TEXT) });
      } else if (p.role === "assistant") {
        const text = textOf(p.content).trim();
        if (!text) continue;
        const last = out[out.length - 1];
        if (last?.kind === "assistant") last.text = tidy(`${last.text}\n\n${text}`, MAX_TEXT);
        else out.push({ kind: "assistant", ts, text: tidy(text, MAX_TEXT) });
      }
    } else if (p.type === "function_call" || p.type === "custom_tool_call" || p.type === "local_shell_call") {
      const raw = p.arguments ?? p.input ?? p.action ?? {};
      let parsed: unknown = raw;
      if (typeof raw === "string") {
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = raw;
        }
      }
      const name = p.name ?? (p.type === "local_shell_call" ? "shell" : "tool");
      const t: Extract<ThreadEntry, { kind: "tool" }> = {
        kind: "tool",
        ts,
        id: p.call_id ?? `${ts}-${out.length}`,
        name,
        summary: redactSecrets(summarize(name, parsed)),
        input: tidy(stringify(parsed), MAX_TOOL_IN),
      };
      if (p.call_id) tools.set(p.call_id, t);
      out.push(t);
    } else if (p.type === "function_call_output" || p.type === "custom_tool_call_output" || p.type === "local_shell_call_output") {
      const t = p.call_id ? tools.get(p.call_id) : undefined;
      if (!t) continue;
      let text = p.output;
      if (typeof text === "string") {
        // function outputs are often {"output": "...", "metadata": {...}}
        try {
          const j = JSON.parse(text) as { output?: string; metadata?: { exit_code?: number } };
          if (typeof j.output === "string") {
            text = j.output;
            if (j.metadata?.exit_code) t.isError = true;
          }
        } catch {
          /* plain text */
        }
      }
      t.output = tidy(resultText(text), MAX_TOOL_OUT);
    }
  }
  return out;
}

/** Full thread of a session on THIS machine; null when its file isn't here. `limit` keeps the newest entries. */
export async function readThread(s: Pick<SessionSummary, "key" | "tool">, limit = 600): Promise<Thread | null> {
  const file = await findSessionFile(s.key);
  if (!file) return null;
  const all = s.tool === "claude" ? await claudeThread(file) : await codexThread(file);
  const entries = limit > 0 && all.length > limit ? all.slice(all.length - limit) : all;
  return { key: s.key, entries, total: all.length, truncated: entries.length < all.length };
}
