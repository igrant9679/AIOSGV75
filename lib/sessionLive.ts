import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import readline from "readline";
import { readConfig } from "./cluster";
import { cleanPromptText, findSessionFile, liveClaudeProcesses, readCodexText, sessionsSnapshot, textOf, type SessionStatus, type SessionTool } from "./sessions";
import { summarize } from "./sessionThread";
import { launchSurface } from "./launchSurface";
import { redactSecrets } from "./sessionDigest";

/**
 * What each OPEN session on this machine is doing right now - its current
 * step, the latest lines of its reply, how long the current turn has run and
 * the tokens it used - plus two warnings:
 *
 *   stuck    it says it's working but its file hasn't changed for 10+ minutes
 *   looping  the same tool call failed 3+ times this turn (or repeats 6+ times)
 *
 * Shared with the other machines through the LAN summary (lib/sessionShare.ts
 * localSummary) and Agentic OS/Cluster/live/<host>.json for Off-LAN ones.
 */

export interface LiveSession {
  key: string;
  host: string;
  hostLabel: string;
  tool: SessionTool;
  title: string;
  project: string;
  status: SessionStatus;
  cwd: string;
  /** desktop app / terminal / IDE (true) vs a background run (false) - Stop asks first for interactive ones */
  interactive: boolean;
  /** when the current turn started (your last message) */
  since?: number;
  lastActivity: number;
  step?: string;
  lastText?: string;
  turnTokens?: number;
  stuck?: string;
  looping?: string;
  at: number;
}

const STUCK_MS = 10 * 60_000;
const TAIL_BYTES = 2 * 1024 * 1024;

interface Call {
  summary: string;
  /** tool + exact input: only IDENTICAL calls count as repeats (editing one file 7 times is normal) */
  sig: string;
  done: boolean;
  error: boolean;
}

interface Parsed {
  since?: number;
  calls: Call[];
  text: string;
  tokens: number;
}

async function tailLines(file: string): Promise<string[]> {
  const st = await fsp.stat(file);
  const start = Math.max(0, st.size - TAIL_BYTES);
  const lines: string[] = [];
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: "utf8", start }), crlfDelay: Infinity });
  let first = start > 0;
  for await (const line of rl) {
    if (first) {
      first = false;
      continue;
    }
    if (line) lines.push(line);
  }
  return lines;
}

function parseClaude(lines: string[]): Parsed {
  let p: Parsed = { calls: [], text: "", tokens: 0 };
  const byId = new Map<string, Call>();
  for (const line of lines) {
    if (!line.includes('"type":"user"') && !line.includes('"type":"assistant"')) continue;
    let o: { type?: string; isMeta?: boolean; isSidechain?: boolean; timestamp?: string; message?: { content?: unknown; usage?: { input_tokens?: number; output_tokens?: number } } };
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (o.isSidechain || o.isMeta || !o.message) continue;
    const c = o.message.content;
    if (o.type === "user") {
      if (Array.isArray(c) && c.some((x) => (x as { type?: string })?.type === "tool_result")) {
        for (const r of c as { type?: string; tool_use_id?: string; is_error?: boolean }[]) {
          const call = r?.tool_use_id ? byId.get(r.tool_use_id) : undefined;
          if (call) {
            call.done = true;
            call.error = Boolean(r.is_error);
          }
        }
        continue;
      }
      if (!cleanPromptText(textOf(c))) continue;
      p = { since: o.timestamp ? Date.parse(o.timestamp) : undefined, calls: [], text: "", tokens: 0 };
      byId.clear();
    } else if (o.type === "assistant") {
      const u = o.message.usage;
      if (u) p.tokens += (u.input_tokens ?? 0) + (u.output_tokens ?? 0);
      if (!Array.isArray(c)) continue;
      for (const x of c as { type?: string; text?: string; id?: string; name?: string; input?: unknown }[]) {
        if (x?.type === "text" && x.text?.trim()) p.text = x.text.trim();
        if (x?.type === "tool_use" && x.name) {
          const call: Call = { summary: summarize(x.name, x.input), sig: x.name + JSON.stringify(x.input ?? {}).slice(0, 600), done: false, error: false };
          if (x.id) byId.set(x.id, call);
          p.calls.push(call);
        }
      }
    }
  }
  return p;
}

function parseCodex(text: string): Parsed {
  let p: Parsed = { calls: [], text: "", tokens: 0 };
  const byId = new Map<string, Call>();
  for (const line of text.split("\n")) {
    if (!line) continue;
    let o: { type?: string; timestamp?: string; payload?: Record<string, unknown> };
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const pl = o.payload ?? {};
    if (o.type === "event_msg" && pl.type === "token_count") {
      const last = (pl.info as { last_token_usage?: { total_tokens?: number } } | undefined)?.last_token_usage;
      if (last?.total_tokens) p.tokens += last.total_tokens;
      continue;
    }
    if (o.type !== "response_item") continue;
    if (pl.type === "message" && pl.role === "user") {
      if (!cleanPromptText(textOf(pl.content))) continue;
      p = { since: o.timestamp ? Date.parse(o.timestamp) : undefined, calls: [], text: "", tokens: 0 };
      byId.clear();
    } else if (pl.type === "message" && pl.role === "assistant") {
      const t = textOf(pl.content).trim();
      if (t) p.text = t;
    } else if (pl.type === "function_call" || pl.type === "custom_tool_call" || pl.type === "local_shell_call") {
      let args: unknown = pl.arguments ?? pl.input ?? pl.action;
      if (typeof args === "string") {
        try {
          args = JSON.parse(args);
        } catch {
          /* raw */
        }
      }
      const call: Call = { summary: summarize(String(pl.name ?? "shell"), args), sig: String(pl.name ?? "shell") + JSON.stringify(args ?? {}).slice(0, 600), done: false, error: false };
      if (typeof pl.call_id === "string") byId.set(pl.call_id, call);
      p.calls.push(call);
    } else if (pl.type === "function_call_output" || pl.type === "custom_tool_call_output" || pl.type === "local_shell_call_output") {
      const call = typeof pl.call_id === "string" ? byId.get(pl.call_id) : undefined;
      if (!call) continue;
      call.done = true;
      const out = typeof pl.output === "string" ? pl.output : "";
      call.error = /"exit_code":\s*[1-9]|Script failed|error:/i.test(out.slice(0, 400));
    }
  }
  return p;
}

function loopWarning(calls: Call[]): string | undefined {
  const fails = new Map<string, { n: number; summary: string }>();
  const all = new Map<string, { n: number; summary: string }>();
  for (const c of calls) {
    const a = all.get(c.sig) ?? { n: 0, summary: c.summary };
    a.n++;
    all.set(c.sig, a);
    if (c.error) {
      const f = fails.get(c.sig) ?? { n: 0, summary: c.summary };
      f.n++;
      fails.set(c.sig, f);
    }
  }
  const worstFail = [...fails.values()].sort((a, b) => b.n - a.n)[0];
  if (worstFail && worstFail.n >= 3) return `${worstFail.summary.slice(0, 120)} failed ${worstFail.n} times this turn`;
  const worst = [...all.values()].sort((a, b) => b.n - a.n)[0];
  if (worst && worst.n >= 6) return `the exact same ${worst.summary.slice(0, 120)} ran ${worst.n} times this turn`;
  return undefined;
}

let cache: { at: number; data: LiveSession[] } | null = null;

export async function liveSnapshot(): Promise<LiveSession[]> {
  if (cache && Date.now() - cache.at < 8_000) return cache.data;
  const [snap, cfg, procs] = await Promise.all([sessionsSnapshot(), readConfig().catch(() => null), liveClaudeProcesses()]);
  const label = cfg?.label || os.hostname();
  const open = snap.sessions.filter((s) => !s.indexing && s.status !== "ended").slice(0, 25);
  const now = Date.now();
  const out: LiveSession[] = [];
  for (const s of open) {
    const file = await findSessionFile(s.key);
    if (!file) continue;
    try {
      const mtime = (await fsp.stat(file)).mtimeMs;
      const p = s.tool === "claude" ? parseClaude(await tailLines(file)) : parseCodex(await readCodexText(file));
      const pending = [...p.calls].reverse().find((c) => !c.done);
      const step =
        s.status === "waiting"
          ? "Waiting for you"
          : pending
            ? `Running ${pending.summary}`
            : s.status === "running"
              ? "Thinking / writing the reply"
              : "Idle - waiting for your next message";
      const proc = s.tool === "claude" ? procs.get(s.id) : undefined;
      const interactive = proc ? proc.kind === "interactive" : launchSurface(s.origin) !== "background";
      out.push({
        key: s.key,
        host: s.host,
        hostLabel: label,
        tool: s.tool,
        title: s.title,
        project: s.project,
        status: s.status,
        cwd: s.cwd,
        interactive,
        since: p.since,
        lastActivity: mtime,
        step: redactSecrets(step).slice(0, 200),
        lastText: p.text ? redactSecrets(p.text.slice(-400)) : undefined,
        turnTokens: p.tokens || undefined,
        stuck: s.status === "running" && now - mtime > STUCK_MS ? `No progress for ${Math.round((now - mtime) / 60_000)} min` : undefined,
        looping: s.status !== "idle" ? loopWarning(p.calls) : undefined,
        at: now,
      });
    } catch {
      /* unreadable right now */
    }
  }
  cache = { at: Date.now(), data: out };
  return out;
}
