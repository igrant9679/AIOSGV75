import fs from "fs";
import fsp from "fs/promises";
import path from "path";

/**
 * The threads of ACP sessions Mission Control ran (lib/acpClient.ts), one file each:
 *
 *   data/acp-sessions/<agent>.<session id>.json
 *
 * ACP has no standard way to list an agent's sessions or read one back (an agent that supports
 * session/load replays it, but only into a live connection), so Mission Control records what it
 * saw while it ran each turn: your messages, the agent's replies and the tools it used. That
 * record is what the Projects page shows and what a fallback (lib/fallback.ts) hands on.
 *
 * Deliberately free of imports from lib/sessions.ts (which imports this), like lib/hermesSessions.ts.
 */

export type AcpEntry =
  | { kind: "user"; ts: number; text: string }
  | { kind: "assistant"; ts: number; text: string }
  | { kind: "tool"; ts: number; id: string; name: string; summary: string; input: string; output?: string; isError?: boolean }
  | { kind: "note"; ts: number; text: string };

export interface AcpSessionRecord {
  v: 1;
  /** "acp:<agent>.<session id>" */
  key: string;
  agent: string;
  agentLabel: string;
  sessionId: string;
  cwd: string;
  title: string;
  startedAt: number;
  updatedAt: number;
  /** a turn is running now (set when a prompt is sent, cleared when it ends) */
  turnOpen: boolean;
  userTurns: number;
  entries: AcpEntry[];
}

const DIR = path.join(process.cwd(), "data", "acp-sessions");
const MAX_ENTRIES = 1500;
const FILE_RE = /^[a-z0-9][a-z0-9-]{0,31}\.[\w.-]{1,160}\.json$/;

const fileOf = (key: string) => path.join(DIR, `${key.slice("acp:".length)}.json`);

export async function readAcpSession(key: string): Promise<AcpSessionRecord | null> {
  if (!key.startsWith("acp:") || !FILE_RE.test(`${key.slice(4)}.json`)) return null;
  try {
    return JSON.parse(await fsp.readFile(fileOf(key), "utf8")) as AcpSessionRecord;
  } catch {
    return null;
  }
}

export async function writeAcpSession(rec: AcpSessionRecord): Promise<void> {
  if (!FILE_RE.test(`${rec.key.slice(4)}.json`)) throw new Error("bad ACP session key");
  if (rec.entries.length > MAX_ENTRIES) rec.entries = [{ kind: "note", ts: rec.entries[0].ts, text: "(older messages were trimmed)" }, ...rec.entries.slice(-MAX_ENTRIES)];
  await fsp.mkdir(DIR, { recursive: true });
  const file = fileOf(rec.key);
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(rec), "utf8");
  await fsp.rename(tmp, file);
}

let memo: { at: number; rows: Omit<AcpSessionRecord, "entries">[] } | null = null;

/** Summaries (no entries) of every recorded ACP session, newest first. Sync: read by the session index. */
export function listAcpSessions(): (Omit<AcpSessionRecord, "entries"> & { firstPrompt: string; lastRole?: string })[] {
  if (memo && Date.now() - memo.at < 4_000) return memo.rows as ReturnType<typeof listAcpSessions>;
  let names: string[] = [];
  try {
    names = fs.readdirSync(DIR).filter((n) => FILE_RE.test(n));
  } catch {
    return [];
  }
  const rows: ReturnType<typeof listAcpSessions> = [];
  for (const n of names) {
    try {
      const r = JSON.parse(fs.readFileSync(path.join(DIR, n), "utf8")) as AcpSessionRecord;
      const { entries, ...rest } = r;
      const first = entries.find((e) => e.kind === "user");
      const last = [...entries].reverse().find((e) => e.kind === "user" || e.kind === "assistant");
      rows.push({ ...rest, firstPrompt: first && "text" in first ? first.text.slice(0, 4000) : "", lastRole: last?.kind });
    } catch {
      /* mid-write */
    }
  }
  rows.sort((a, b) => b.updatedAt - a.updatedAt);
  memo = { at: Date.now(), rows };
  return rows;
}

export function forgetAcpListing(): void {
  memo = null;
}
