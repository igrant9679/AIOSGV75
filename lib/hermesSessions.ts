import fs from "fs";
import os from "os";
import path from "path";

/**
 * Hermes's own sessions, read straight from its session store.
 *
 * Claude Code and Codex write one file per session; Hermes keeps everything in
 * one SQLite database (<hermes home>/state.db: a `sessions` row per session, a
 * `messages` row per message). So instead of the file index in lib/sessions.ts
 * this asks the database, read-only, each time — a few milliseconds for
 * hundreds of sessions, and never stale.
 *
 * Read-only in the strict sense: the database is opened with readOnly, nothing
 * here writes to Hermes's home, and auth.json / .env are never opened.
 *
 * Deliberately free of imports from lib/sessions.ts (which imports this), so
 * it returns raw rows; prompt cleaning, secret redaction and naming happen in
 * the callers, the same way as for the other tools.
 */

export interface HermesSessionRow {
  id: string;
  /** where it was started: cli, telegram, discord, cron, … */
  source: string;
  title?: string;
  cwd: string;
  model?: string;
  startedAt: number;
  updatedAt: number;
  ended: boolean;
  userTurns: number;
  tokensIn: number;
  tokensOut: number;
  tokensCached: number;
  /** raw first user message (may carry Mission Control's context preamble) */
  firstPrompt: string;
  /** role of the newest message — a session whose last word is the user's or a tool's is mid-turn */
  lastRole?: string;
  billingProvider?: string;
  billingMode?: string;
}

export interface HermesMessage {
  role: string;
  ts: number;
  text: string;
  /** role "tool": which call this answers, and the tool's name */
  toolCallId?: string;
  toolName?: string;
  /** role "assistant": the calls it made */
  toolCalls: { id: string; name: string; args: unknown }[];
}

/** Hermes's home folder: %LOCALAPPDATA%\hermes on Windows (not ~/.hermes), ~/.hermes elsewhere. */
export function hermesHome(): string {
  if (process.env.HERMES_HOME) return process.env.HERMES_HOME;
  if (process.env.HERMES_CONFIG) return path.dirname(process.env.HERMES_CONFIG);
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    const dir = path.join(local, "hermes");
    if (fs.existsSync(dir)) return dir;
  }
  return path.join(os.homedir(), ".hermes");
}

type Row = Record<string, unknown>;
interface Db {
  prepare(sql: string): { all(...params: unknown[]): Row[] };
  close(): void;
}

/**
 * node:sqlite ships with Node 22.5+. Loaded through getBuiltinModule so the
 * bundler never tries to resolve it, and so an older Node simply reports "no
 * Hermes sessions" instead of failing the whole sessions page.
 */
function openDb(): Db | null {
  const file = path.join(hermesHome(), "state.db");
  if (!fs.existsSync(file)) return null;
  try {
    const get = (process as unknown as { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule;
    const mod = get?.("node:sqlite") as { DatabaseSync: new (file: string, opts: { readOnly: boolean }) => Db } | undefined;
    if (!mod) return null;
    return new mod.DatabaseSync(file, { readOnly: true });
  } catch {
    return null; // locked mid-migration, or not a database we understand
  }
}

/** Columns differ between Hermes versions; ask instead of assuming. */
function columns(db: Db, table: string): Set<string> {
  try {
    return new Set(db.prepare(`pragma table_info(${table})`).all().map((r) => String(r.name)));
  } catch {
    return new Set();
  }
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "bigint" ? Number(v) : 0);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v : undefined);
/** Hermes stores unix seconds as REAL. */
const ms = (v: unknown): number => Math.round(num(v) * 1000);

/** Message content is plain text, or a JSON array of parts ([{type:"text",text}, {type:"image_url",…}]). */
function contentText(v: unknown): string {
  if (typeof v !== "string") return "";
  const t = v.trim();
  if (t.startsWith("[{")) {
    try {
      const parts = JSON.parse(t) as { type?: string; text?: string }[];
      if (Array.isArray(parts)) {
        return parts
          .map((p) => (typeof p?.text === "string" ? p.text : p?.type && p.type !== "text" ? `[${p.type}]` : ""))
          .filter(Boolean)
          .join("\n");
      }
    } catch {
      /* it only looked like JSON */
    }
  }
  return v;
}

let memo: { at: number; rows: HermesSessionRow[] } | null = null;

/** True when this machine has a Hermes session store at all. */
export function hermesInstalled(): boolean {
  return fs.existsSync(path.join(hermesHome(), "state.db"));
}

/**
 * Newest sessions first. Third-party integrations that mark themselves
 * `source = 'tool'` and sessions you archived in Hermes are left out, as
 * Hermes's own session list does.
 */
export function hermesSessions(limit = 400): HermesSessionRow[] {
  if (memo && Date.now() - memo.at < 4_000) return memo.rows;
  const db = openDb();
  if (!db) return [];
  try {
    const s = columns(db, "sessions");
    const m = columns(db, "messages");
    if (!s.has("id") || !s.has("started_at") || !m.has("session_id")) return [];
    const col = (name: string) => (s.has(name) ? `s.${name}` : "null");
    const active = m.has("active") ? " and m.active = 1" : "";
    const where = [s.has("archived") ? "coalesce(s.archived, 0) = 0" : "", s.has("source") ? "coalesce(s.source, '') != 'tool'" : ""].filter(Boolean);
    const rows = db
      .prepare(
        `select s.id as id, ${col("source")} as source, ${col("title")} as title, ${col("cwd")} as cwd, ${col("model")} as model,
                s.started_at as started_at, ${col("ended_at")} as ended_at,
                ${col("input_tokens")} as input_tokens, ${col("output_tokens")} as output_tokens, ${col("cache_read_tokens")} as cache_read_tokens,
                ${col("billing_provider")} as billing_provider, ${col("billing_mode")} as billing_mode,
                (select count(*) from messages m where m.session_id = s.id and m.role = 'user'${active}) as user_turns,
                (select max(m.timestamp) from messages m where m.session_id = s.id) as last_ts,
                (select m.role from messages m where m.session_id = s.id order by m.id desc limit 1) as last_role,
                (select m.content from messages m where m.session_id = s.id and m.role = 'user'${active} order by m.id limit 1) as first_prompt
           from sessions s
          ${where.length ? `where ${where.join(" and ")}` : ""}
          order by s.started_at desc
          limit ?`,
      )
      .all(limit);
    const out = rows.map((r): HermesSessionRow => {
      const startedAt = ms(r.started_at);
      return {
        id: String(r.id),
        source: str(r.source) ?? "cli",
        title: str(r.title),
        cwd: str(r.cwd) ?? "",
        model: str(r.model),
        startedAt,
        updatedAt: Math.max(startedAt, ms(r.last_ts), ms(r.ended_at)),
        ended: r.ended_at !== null && r.ended_at !== undefined,
        userTurns: num(r.user_turns),
        tokensIn: num(r.input_tokens),
        tokensOut: num(r.output_tokens),
        tokensCached: num(r.cache_read_tokens),
        firstPrompt: contentText(r.first_prompt).slice(0, 4000),
        lastRole: str(r.last_role),
        billingProvider: str(r.billing_provider),
        billingMode: str(r.billing_mode),
      };
    });
    memo = { at: Date.now(), rows: out };
    return out;
  } catch {
    return [];
  } finally {
    db.close();
  }
}

/** Every live message of one session, oldest first. Empty when the session isn't in this machine's store. */
export function hermesMessages(id: string): HermesMessage[] {
  if (!/^[\w.-]{1,120}$/.test(id)) return [];
  const db = openDb();
  if (!db) return [];
  try {
    const m = columns(db, "messages");
    const col = (name: string) => (m.has(name) ? name : "null");
    const rows = db
      .prepare(
        `select role, content, timestamp, ${col("tool_call_id")} as tool_call_id, ${col("tool_name")} as tool_name, ${col("tool_calls")} as tool_calls
           from messages
          where session_id = ?${m.has("active") ? " and active = 1" : ""}
          order by id`,
      )
      .all(id);
    return rows.map((r): HermesMessage => {
      let toolCalls: HermesMessage["toolCalls"] = [];
      if (typeof r.tool_calls === "string" && r.tool_calls.trim().startsWith("[")) {
        try {
          // OpenAI shape: [{ id, type: "function", function: { name, arguments: "<json>" } }]
          const calls = JSON.parse(r.tool_calls) as { id?: string; name?: string; function?: { name?: string; arguments?: unknown } }[];
          toolCalls = calls.map((c, i) => {
            let args: unknown = c.function?.arguments;
            if (typeof args === "string") {
              try {
                args = JSON.parse(args);
              } catch {
                /* keep the raw string */
              }
            }
            return { id: String(c.id ?? `call-${i}`), name: String(c.function?.name ?? c.name ?? "tool"), args };
          });
        } catch {
          /* unreadable call list — the text still shows */
        }
      }
      return {
        role: String(r.role),
        ts: ms(r.timestamp),
        text: contentText(r.content),
        toolCallId: str(r.tool_call_id),
        toolName: str(r.tool_name),
        toolCalls,
      };
    });
  } catch {
    return [];
  } finally {
    db.close();
  }
}
