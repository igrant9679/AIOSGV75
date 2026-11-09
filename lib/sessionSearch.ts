import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import readline from "readline";
import { readConfig } from "./cluster";
import { vaultInfo } from "./vault";
import { localSessionFiles, readCodexText, sessionsSnapshot, textOf, type SessionTool } from "./sessions";
import { readRemoteSessions } from "./sessionShare";
import { PeerUnavailable, peerFetch } from "./peer";
import { redactSecrets } from "./sessionDigest";

/**
 * Search the full threads of every session on every machine - messages,
 * replies, tool calls and their output:
 *   - this machine: its session files, newest first, within a time budget
 *   - LAN machines: they search their own files (/peer/search)
 *   - others: the conversation notes they share in the vault (messages only)
 */

export interface SearchHit {
  key: string;
  host: string;
  hostLabel: string;
  tool: SessionTool;
  title: string;
  project: string;
  updatedAt: number;
  /** where the hits came from */
  via: "local" | "lan" | "vault";
  snippets: { role: string; text: string }[];
}

const BUDGET_MS = 8_000;
const PER_SESSION = 3;

function snippet(text: string, ql: string): string | null {
  const i = text.toLowerCase().indexOf(ql);
  if (i < 0) return null;
  const a = Math.max(0, i - 90);
  const b = Math.min(text.length, i + ql.length + 140);
  return redactSecrets(`${a > 0 ? "…" : ""}${text.slice(a, b).replace(/\s+/g, " ").trim()}${b < text.length ? "…" : ""}`);
}

/** Texts worth searching in one transcript line, with a label for each. */
function textsOf(line: string, tool: SessionTool): { role: string; text: string }[] {
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(line);
  } catch {
    return [];
  }
  const out: { role: string; text: string }[] = [];
  if (tool === "claude") {
    const msg = o.message as { content?: unknown } | undefined;
    if (!msg || o.isMeta) return out;
    const c = msg.content;
    if (typeof c === "string") out.push({ role: o.type === "user" ? "You" : "Claude", text: c });
    else if (Array.isArray(c)) {
      for (const x of c as { type?: string; text?: string; name?: string; input?: unknown; content?: unknown }[]) {
        if (x?.type === "text" && x.text) out.push({ role: o.type === "user" ? "You" : "Claude", text: x.text });
        else if (x?.type === "tool_use") out.push({ role: `Tool ${x.name ?? ""}`.trim(), text: JSON.stringify(x.input ?? {}) });
        else if (x?.type === "tool_result") out.push({ role: "Tool result", text: typeof x.content === "string" ? x.content : textOf(x.content) });
      }
    }
  } else {
    const p = o.payload as Record<string, unknown> | undefined;
    if (o.type !== "response_item" || !p) return out;
    if (p.type === "message") out.push({ role: p.role === "user" ? "You" : "Codex", text: textOf(p.content) });
    else if (typeof p.arguments === "string" || typeof p.input === "string") out.push({ role: `Tool ${String(p.name ?? "")}`.trim(), text: String(p.arguments ?? p.input) });
    else if (typeof p.output === "string") out.push({ role: "Tool result", text: p.output });
  }
  return out;
}

export async function searchLocal(q: string, limit = 30): Promise<SearchHit[]> {
  const ql = q.trim().toLowerCase();
  if (ql.length < 2) return [];
  const started = Date.now();
  const [files, snap, cfg] = await Promise.all([localSessionFiles(), sessionsSnapshot(), readConfig().catch(() => null)]);
  const meta = new Map(snap.sessions.map((s) => [s.key, s]));
  const label = cfg?.label || os.hostname();
  const hits: SearchHit[] = [];
  for (const f of files) {
    if (hits.length >= limit || Date.now() - started > BUDGET_MS) break;
    const s = meta.get(f.key);
    const snippets: { role: string; text: string }[] = [];
    const consider = (line: string) => {
      if (!line.toLowerCase().includes(ql)) return;
      for (const t of textsOf(line, f.tool)) {
        const sn = snippet(t.text, ql);
        if (sn) snippets.push({ role: t.role, text: sn });
        if (snippets.length >= PER_SESSION) return;
      }
    };
    try {
      if (f.tool === "claude") {
        const rl = readline.createInterface({ input: fs.createReadStream(f.file, { encoding: "utf8" }), crlfDelay: Infinity });
        for await (const line of rl) {
          consider(line);
          if (snippets.length >= PER_SESSION) {
            rl.close();
            break;
          }
        }
      } else {
        for (const line of (await readCodexText(f.file)).split("\n")) {
          consider(line);
          if (snippets.length >= PER_SESSION) break;
        }
      }
    } catch {
      continue;
    }
    // the title itself counts too
    if (!snippets.length && s?.title.toLowerCase().includes(ql)) snippets.push({ role: "Title", text: s.title });
    if (snippets.length) {
      hits.push({
        key: f.key,
        host: os.hostname(),
        hostLabel: label,
        tool: f.tool,
        title: s?.title ?? f.key,
        project: s?.project ?? "",
        updatedAt: f.updatedAt,
        via: "local",
        snippets,
      });
    }
  }
  return hits;
}

/** Conversation notes another machine shared (messages only), for machines not reachable over the LAN. */
async function searchDigests(machineLabel: string, host: string, ql: string, limit: number): Promise<SearchHit[]> {
  const dir = path.join(vaultInfo().base, "Sessions", machineLabel.replace(/[\\/:*?"<>|#^[\]]+/g, " ").replace(/\s+/g, " ").trim());
  const names = (await fsp.readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith(".md")).sort().reverse();
  const hits: SearchHit[] = [];
  for (const n of names) {
    if (hits.length >= limit) break;
    const text = await fsp.readFile(path.join(dir, n), "utf8").catch(() => "");
    if (!text.toLowerCase().includes(ql)) continue;
    const key = text.match(/^session:\s*(\S+)/m)?.[1] ?? "";
    const title = text.match(/^# (.+)$/m)?.[1] ?? n;
    const project = (text.match(/^project:\s*"?([^"\n]+)"?/m)?.[1] ?? "").trim();
    const updated = Date.parse(text.match(/^updated:\s*(\S+)/m)?.[1] ?? "") || 0;
    const sn = snippet(text.replace(/^---[\s\S]*?\n---\n/, ""), ql);
    if (!key || !sn) continue;
    hits.push({ key, host, hostLabel: machineLabel, tool: key.startsWith("codex:") ? "codex" : "claude", title, project, updatedAt: updated, via: "vault", snippets: [{ role: "Conversation", text: sn }] });
  }
  return hits;
}

export async function searchFleet(q: string): Promise<{ hits: SearchHit[]; notes: string[] }> {
  const ql = q.trim().toLowerCase();
  if (ql.length < 2) return { hits: [], notes: [] };
  const remote = await readRemoteSessions().catch(() => []);
  const notes: string[] = [];
  const jobs = remote.map(async (f) => {
    const label = f.label || f.host;
    try {
      const r = await peerFetch<{ results: SearchHit[] }>(f.host, `/peer/search?q=${encodeURIComponent(q)}`, { timeoutMs: 12_000 });
      return r.results.map((h) => ({ ...h, via: "lan" as const, host: f.host, hostLabel: label }));
    } catch (e) {
      if (!(e instanceof PeerUnavailable)) notes.push(`${label}: ${(e as Error).message} - searched its shared conversations instead.`);
      return searchDigests(label, f.host, ql, 15);
    }
  });
  const [mine, ...others] = await Promise.all([searchLocal(q, 30), ...jobs]);
  const hits = [...mine, ...others.flat()].sort((a, b) => b.updatedAt - a.updatedAt);
  return { hits, notes };
}
