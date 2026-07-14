import fs from "fs/promises";
import path from "path";
import { vaultInfo, vaultAvailable } from "./vault";

/**
 * Conversation search — parses the vault's daily chat logs
 * (Agentic OS/Chats/YYYY-MM-DD.md) into individual exchanges so you can search
 * across every agent by topic/keyword and see which agent, when, on which
 * machine, with a title (your opening line), a snippet, and the agent's output.
 * Everything is derived from the synced vault, so it spans all machines.
 */
export interface Exchange {
  id: string;
  agent: string; // display name parsed from the heading wikilink
  date: string; // YYYY-MM-DD (from the filename)
  time: string; // HH:MM:SS
  host: string; // machine tag, or "" for older untagged chats
  title: string; // first user line — the topic
  userText: string;
  assistantText: string; // the agent's output
  wordCount: number;
  file: string; // vault-relative path (for obsidian:// deep links)
  body: string; // full exchange markdown
}

export interface ConvoFacets {
  agents: { key: string; count: number }[];
  hosts: { key: string; count: number }[];
  dates: { key: string; count: number }[];
}

function chatsDir(): string {
  return path.join(vaultInfo().base, "Chats");
}

const HEADING_RE = /^###\s+(\d{1,2}:\d{2}:\d{2})\s+·\s+(.+)$/;

function parseAgent(headingRest: string): { agent: string; host: string } {
  // e.g. "[[Agentic OS/Agents/Claude|Claude]] · 🖥 DESKTOP-K82"
  let host = "";
  const hostMatch = headingRest.match(/🖥\s*([^\s·]+)/);
  if (hostMatch) host = hostMatch[1];
  const link = headingRest.match(/\[\[[^\]|]*\|([^\]]+)\]\]/) || headingRest.match(/\[\[([^\]]+)\]\]/);
  let agent = link ? link[1].split("/").pop()!.trim() : headingRest.split("·")[0].trim();
  agent = agent.replace(/🖥.*$/, "").trim();
  return { agent, host };
}

function extractRoles(body: string): { title: string; userText: string; assistantText: string } {
  const userParts: string[] = [];
  const asstParts: string[] = [];
  let mode: "user" | "asst" | null = null;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw;
    if (/^\*\*You:\*\*/.test(line)) { mode = "user"; continue; }
    if (/^\*\*[^*]+:\*\*/.test(line)) { mode = "asst"; continue; }
    if (/^>\s/.test(line)) continue; // tool/system/error quoted lines
    if (mode === "user") userParts.push(line);
    else if (mode === "asst") asstParts.push(line);
  }
  const userText = userParts.join("\n").trim();
  const assistantText = asstParts.join("\n").trim();
  const title = (userText.split(/\n/).find((l) => l.trim()) || userText || "(no prompt)").trim().slice(0, 140);
  return { title, userText, assistantText };
}

async function parseFile(file: string): Promise<Exchange[]> {
  const abs = path.join(chatsDir(), file);
  const raw = await fs.readFile(abs, "utf8").catch(() => "");
  if (!raw) return [];
  const date = file.replace(/\.md$/, "");
  const rel = `Agentic OS/Chats/${file}`;
  const out: Exchange[] = [];
  // split into blocks that each start with a "### " heading
  const lines = raw.split(/\r?\n/);
  let cur: { heading: string; body: string[] } | null = null;
  const flush = (idx: number) => {
    if (!cur) return;
    const m = cur.heading.match(HEADING_RE);
    if (m) {
      const time = m[1];
      const { agent, host } = parseAgent(m[2]);
      const body = cur.body.join("\n").trim();
      const { title, userText, assistantText } = extractRoles(body);
      const wordCount = (userText + " " + assistantText).split(/\s+/).filter(Boolean).length;
      out.push({ id: `${date}#${idx}`, agent, date, time, host, title, userText, assistantText, wordCount, file: rel, body });
    }
    cur = null;
  };
  let n = 0;
  for (const line of lines) {
    if (/^###\s/.test(line)) {
      flush(n++);
      cur = { heading: line, body: [] };
    } else if (cur) {
      cur.body.push(line);
    }
  }
  flush(n);
  return out;
}

export async function listExchanges(): Promise<Exchange[]> {
  const files = (await fs.readdir(chatsDir()).catch(() => [] as string[])).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort().reverse();
  const all: Exchange[] = [];
  for (const f of files) all.push(...(await parseFile(f)));
  // newest first
  return all.sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
}

function facetsOf(items: Exchange[]): ConvoFacets {
  const tally = (key: (e: Exchange) => string) => {
    const m = new Map<string, number>();
    for (const e of items) {
      const k = key(e);
      if (!k) continue;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
  };
  return { agents: tally((e) => e.agent), hosts: tally((e) => e.host || "unknown"), dates: tally((e) => e.date) };
}

function snippet(text: string, terms: string[], len = 220): string {
  const lower = text.toLowerCase();
  let at = -1;
  for (const t of terms) {
    const i = lower.indexOf(t);
    if (i >= 0 && (at === -1 || i < at)) at = i;
  }
  if (at === -1) return text.slice(0, len).trim() + (text.length > len ? "…" : "");
  const start = Math.max(0, at - 60);
  return (start > 0 ? "…" : "") + text.slice(start, start + len).trim() + (start + len < text.length ? "…" : "");
}

export interface ConvoResult extends Exchange {
  snippet: string;
  score: number;
}

export async function searchConversations(opts: {
  q?: string;
  agent?: string;
  host?: string;
  date?: string;
  limit?: number;
}): Promise<{ results: ConvoResult[]; facets: ConvoFacets; total: number }> {
  let items = await listExchanges();
  const facets = facetsOf(items); // facets over everything (before text filter) so counts are stable
  if (opts.agent) items = items.filter((e) => e.agent === opts.agent);
  if (opts.host) items = items.filter((e) => (e.host || "unknown") === opts.host);
  if (opts.date) items = items.filter((e) => e.date === opts.date);

  const q = (opts.q ?? "").trim().toLowerCase();
  const terms = q.split(/\s+/).filter(Boolean);
  let scored: ConvoResult[];
  if (terms.length === 0) {
    scored = items.map((e) => ({ ...e, snippet: snippet(e.assistantText || e.userText, []), score: 0 }));
  } else {
    scored = [];
    for (const e of items) {
      const hay = (e.title + "\n" + e.userText + "\n" + e.assistantText).toLowerCase();
      let score = 0;
      for (const t of terms) {
        let idx = hay.indexOf(t), hits = 0;
        while (idx >= 0) { hits++; idx = hay.indexOf(t, idx + t.length); }
        if (hits > 0) score += hits + (e.title.toLowerCase().includes(t) ? 5 : 0);
      }
      if (score > 0) scored.push({ ...e, snippet: snippet(e.assistantText || e.userText, terms), score });
    }
    scored.sort((a, b) => b.score - a.score || (b.date + b.time).localeCompare(a.date + a.time));
  }
  const total = scored.length;
  return { results: scored.slice(0, opts.limit ?? 150), facets, total };
}

export async function conversationsAvailable(): Promise<boolean> {
  return vaultAvailable();
}
