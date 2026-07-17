import fs from "fs/promises";
import path from "path";
import { vaultInfo, vaultAvailable } from "./vault";
import { runAgentText } from "./runners";

/**
 * Conversation search — parses the vault's daily chat logs
 * (Agentic OS/Chats/YYYY-MM-DD.md) into individual exchanges so you can search
 * across every agent by topic/keyword and see which agent, when, on which
 * machine, with a title (your opening line), a snippet, and the agent's output.
 * Everything is derived from the synced vault, so it spans all machines.
 */
export interface Exchange {
  id: string;
  kind: "chat" | "history"; // a live Mission Control exchange, or a distilled imported topic
  agent: string; // display name parsed from the heading wikilink
  date: string; // YYYY-MM-DD (from the filename)
  time: string; // HH:MM:SS
  host: string; // machine tag, or "" for older untagged chats
  title: string; // first user line — the topic
  userText: string;
  assistantText: string; // the agent's output
  turns: number; // number of back-and-forths in this exchange
  wordCount: number;
  file: string; // vault-relative path (for obsidian:// deep links)
  body: string; // full exchange markdown
  tags?: string[]; // history topics carry their note's frontmatter tags
}

export interface ConvoFacets {
  agents: { key: string; count: number }[];
  hosts: { key: string; count: number }[];
  dates: { key: string; count: number }[];
}

function chatsDir(): string {
  return path.join(vaultInfo().base, "Chats");
}

function historyDir(): string {
  return path.join(vaultInfo().base, "History");
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
      const turns = (body.match(/^\*\*You:\*\*/gm) || []).length || 1;
      out.push({ id: `${date}#${idx}`, kind: "chat", agent, date, time, host, title, userText, assistantText, turns, wordCount, file: rel, body });
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

/**
 * Distilled imported history (Agentic OS/History/) is searchable here too, but
 * it isn't shaped like a chat: one note covers 12 conversations, grouped under
 * "## " topic headings. We index one record PER TOPIC — searching "salesforce"
 * should surface that topic and its bullets, not a 12-conversation wall.
 * Index hubs are skipped (they're link lists, not content).
 */
async function parseHistoryFile(file: string): Promise<Exchange[]> {
  const abs = path.join(historyDir(), file);
  const raw = await fs.readFile(abs, "utf8").catch(() => "");
  if (!raw) return [];

  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const date = fm?.[1].match(/^date:\s*(\d{4}-\d{2}-\d{2})/m)?.[1] ?? file.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? "";
  const tags = (fm?.[1].match(/^tags:\s*\[(.+)\]/m)?.[1] ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const rel = `Agentic OS/History/${file}`;
  const body = fm ? raw.slice(fm[0].length) : raw;
  const out: Exchange[] = [];
  const lines = body.split(/\r?\n/);
  let cur: { title: string; body: string[] } | null = null;
  let n = 0;

  // Every note ends with an identically-titled "Durable facts about the owner"
  // section, so 187 notes would yield 187 results with the same title. Suffix
  // it with the note's run stamp to keep them tellable apart in a result list.
  const stamp = file.replace(/^Imported History\s*/i, "").replace(/\.md$/i, "").trim();

  const flush = () => {
    if (!cur) return;
    // "Sources" is a bibliography, not knowledge — skip it.
    if (/^sources\b/i.test(cur.title)) {
      cur = null;
      return;
    }
    const text = cur.body.join("\n").trim();
    if (text) {
      const bullets = (text.match(/^\s*[-*]\s/gm) || []).length;
      const title = /^durable facts/i.test(cur.title) ? `${cur.title} · ${stamp}` : cur.title;
      out.push({
        id: `h:${file}#${n++}`,
        kind: "history",
        agent: "History",
        date,
        // synthetic, ordered — history has no clock, but sorting needs a key
        time: `00:${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`,
        host: "imported",
        title: title.slice(0, 140),
        userText: "",
        assistantText: text,
        turns: bullets || 1,
        wordCount: text.split(/\s+/).filter(Boolean).length,
        file: rel,
        body: `## ${cur.title}\n\n${text}`,
        tags,
      });
    }
    cur = null;
  };

  for (const line of lines) {
    const h = line.match(/^##\s+(.+)$/);
    if (h) {
      flush();
      cur = { title: h[1].trim(), body: [] };
    } else if (cur) {
      cur.body.push(line);
    }
  }
  flush();
  return out;
}

export async function listExchanges(): Promise<Exchange[]> {
  const files = (await fs.readdir(chatsDir()).catch(() => [] as string[])).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort().reverse();
  const all: Exchange[] = [];
  for (const f of files) all.push(...(await parseFile(f)));

  const hist = (await fs.readdir(historyDir()).catch(() => [] as string[])).filter(
    (f) => f.endsWith(".md") && !f.includes("Index"),
  );
  for (const f of hist) all.push(...(await parseHistoryFile(f)));

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

/** Strip markdown chrome (headings, role labels, quotes, separators) for clean snippets/search. */
function plainText(body: string): string {
  return body
    .split(/\r?\n/)
    .filter((l) => !/^#{1,6}\s/.test(l) && !/^---+$/.test(l) && !/^>\s/.test(l))
    .map((l) => l.replace(/^\*\*[^*]+:\*\*\s*/, ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
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

/** A search result — one exchange, or one session (a day's chats with an agent). */
export interface SearchItem {
  id: string;
  kind: "chat" | "history";
  agent: string;
  date: string;
  time: string; // first time in a session
  lastTime: string;
  host: string;
  title: string;
  turns: number;
  wordCount: number;
  exchangeCount: number; // 1 for an exchange, N for a session
  file: string;
  body: string;
  snippet: string;
  score: number;
  summary?: string; // cached AI one-liner, if generated
  tags?: string[];
}

/** Group exchanges into sessions: a day's back-and-forth with one agent on one machine. */
export function groupSessions(exchanges: Exchange[]): SearchItem[] {
  const map = new Map<string, Exchange[]>();
  for (const e of exchanges) {
    const key = `${e.date}|${e.agent}|${e.host || "unknown"}`;
    const arr = map.get(key);
    if (arr) arr.push(e);
    else map.set(key, [e]);
  }
  const out: SearchItem[] = [];
  for (const [key, list] of map) {
    list.sort((a, b) => a.time.localeCompare(b.time));
    const first = list[0];
    out.push({
      id: `s:${key}`,
      kind: first.kind,
      agent: first.agent,
      date: first.date,
      time: first.time,
      lastTime: list[list.length - 1].time,
      host: first.host,
      title: first.title,
      turns: list.reduce((n, e) => n + e.turns, 0),
      wordCount: list.reduce((n, e) => n + e.wordCount, 0),
      exchangeCount: list.length,
      file: first.file,
      body: list.map((e) => e.body).join("\n\n---\n\n"),
      snippet: "",
      score: 0,
    });
  }
  return out;
}

function toItem(e: Exchange): SearchItem {
  return {
    id: e.id,
    kind: e.kind,
    tags: e.tags,
    agent: e.agent,
    date: e.date,
    time: e.time,
    lastTime: e.time,
    host: e.host,
    title: e.title,
    turns: e.turns,
    wordCount: e.wordCount,
    exchangeCount: 1,
    file: e.file,
    body: e.body,
    snippet: "",
    score: 0,
  };
}

export async function searchConversations(opts: {
  q?: string;
  agent?: string;
  host?: string;
  date?: string;
  group?: "exchange" | "session";
  limit?: number;
}): Promise<{ results: SearchItem[]; facets: ConvoFacets; total: number; group: string }> {
  const exchanges = await listExchanges();
  const facets = facetsOf(exchanges); // facets over everything so counts are stable
  let ex = exchanges;
  if (opts.agent) ex = ex.filter((e) => e.agent === opts.agent);
  if (opts.host) ex = ex.filter((e) => (e.host || "unknown") === opts.host);
  if (opts.date) ex = ex.filter((e) => e.date === opts.date);

  const group = opts.group === "session" ? "session" : "exchange";
  let items = group === "session" ? groupSessions(ex) : ex.map(toItem);

  const q = (opts.q ?? "").trim().toLowerCase();
  const terms = q.split(/\s+/).filter(Boolean);
  if (terms.length === 0) {
    items = items
      .map((it) => ({ ...it, snippet: snippet(plainText(it.body), []) }))
      .sort((a, b) => (b.date + b.lastTime).localeCompare(a.date + a.lastTime));
  } else {
    const scored: SearchItem[] = [];
    for (const it of items) {
      const plain = plainText(it.body);
      const hay = plain.toLowerCase();
      let score = 0;
      for (const t of terms) {
        let idx = hay.indexOf(t);
        let hits = 0;
        while (idx >= 0) {
          hits++;
          idx = hay.indexOf(t, idx + t.length);
        }
        if (hits > 0) score += hits + (it.title.toLowerCase().includes(t) ? 5 : 0);
      }
      if (score > 0) scored.push({ ...it, snippet: snippet(plain, terms), score });
    }
    scored.sort((a, b) => b.score - a.score || (b.date + b.lastTime).localeCompare(a.date + a.lastTime));
    items = scored;
  }

  const total = items.length;
  const results = items.slice(0, opts.limit ?? 150);
  const summaries = await readSummaries();
  for (const it of results) if (summaries[it.id]) it.summary = summaries[it.id];
  return { results, facets, total, group };
}

// ─── AI one-line summaries (cached in data/convo-summaries.json) ───
const SUMMARY_FILE = path.join(process.cwd(), "data", "convo-summaries.json");

async function readSummaries(): Promise<Record<string, string>> {
  try {
    return JSON.parse(await fs.readFile(SUMMARY_FILE, "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}
async function writeSummaries(m: Record<string, string>): Promise<void> {
  await fs.mkdir(path.dirname(SUMMARY_FILE), { recursive: true });
  await fs.writeFile(SUMMARY_FILE, JSON.stringify(m, null, 2), "utf8");
}

function summaryPrompt(it: SearchItem): string {
  const transcript = it.body.replace(/\r?\n{3,}/g, "\n\n").slice(0, 2200);
  return [
    `Summarize what this AI chat was about in ONE short line (max 14 words). Focus on the topic and any conclusion. No preamble, no quotes, just the line.`,
    ``,
    transcript,
  ].join("\n");
}

/** Generate + cache one-line summaries for the given result ids (bounded). */
export async function summarizeIds(ids: string[], group: "exchange" | "session", agent = "auto"): Promise<Record<string, string>> {
  const exchanges = await listExchanges();
  const items = group === "session" ? groupSessions(exchanges) : exchanges.map(toItem);
  const byId = new Map(items.map((it) => [it.id, it]));
  const cache = await readSummaries();
  const todo = ids.filter((id) => !cache[id] && byId.has(id)).slice(0, 10);

  await Promise.all(
    todo.map(async (id) => {
      const it = byId.get(id)!;
      try {
        const r = await runAgentText(agent, summaryPrompt(it), { injectMemory: false });
        const line = (r.text || "").split(/\r?\n/).map((l) => l.trim()).find(Boolean) || "";
        if (line && !r.error) cache[id] = line.replace(/^["'\-•*\s]+/, "").slice(0, 160);
      } catch {
        /* skip on error */
      }
    }),
  );
  await writeSummaries(cache);
  return cache;
}

// ─── analytics over all conversations ───
const STOPWORDS = new Set(
  "the a an and or but to of in on for with is are was were be been being it this that these those i you he she we they me my your our their its it's im i'm can could would should do does did done have has had will just what how why when where who which as at by from up out so if not no yes ok okay please thanks thank hi hello hey get got make made give one two also into about your you're can't don't let lets need want like use using".split(
    /\s+/,
  ),
);

export interface ConvoAnalytics {
  totals: { exchanges: number; sessions: number; words: number; agents: number; machines: number; days: number; firstDate: string; lastDate: string };
  byAgent: { key: string; count: number; words: number }[];
  byMachine: { key: string; count: number }[];
  byDay: { date: string; count: number }[];
  topKeywords: { term: string; count: number }[];
  records: { avgWords: number; busiestDay: string; busiestDayCount: number; topAgent: string; deepestTurns: number };
}

export async function conversationAnalytics(): Promise<ConvoAnalytics> {
  // Live chats only. Imported history is thousands of topics all stamped with
  // their distill date — including it would bury the real activity trend under
  // one enormous spike and make "busiest day" meaningless.
  const exchanges = (await listExchanges()).filter((e) => e.kind === "chat");
  const sessions = groupSessions(exchanges);
  const words = exchanges.reduce((n, e) => n + e.wordCount, 0);
  const dates = [...new Set(exchanges.map((e) => e.date))].sort();

  const facets = facetsOf(exchanges);
  const byAgentWords = new Map<string, number>();
  for (const e of exchanges) byAgentWords.set(e.agent, (byAgentWords.get(e.agent) ?? 0) + e.wordCount);
  const byAgent = facets.agents.map((a) => ({ key: a.key, count: a.count, words: byAgentWords.get(a.key) ?? 0 }));

  const byDayMap = new Map<string, number>();
  for (const e of exchanges) byDayMap.set(e.date, (byDayMap.get(e.date) ?? 0) + 1);
  const byDay = [...byDayMap.entries()].map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date));

  // keyword frequency over the user's questions (most topic-indicative)
  const kw = new Map<string, number>();
  for (const e of exchanges) {
    const seen = new Set<string>();
    for (const w of (e.title + " " + e.userText).toLowerCase().match(/[a-z][a-z'-]{2,}/g) ?? []) {
      if (STOPWORDS.has(w) || w.length < 3) continue;
      if (seen.has(w)) continue; // count each word once per exchange (document frequency)
      seen.add(w);
      kw.set(w, (kw.get(w) ?? 0) + 1);
    }
  }
  const topKeywords = [...kw.entries()].filter(([, c]) => c > 1).map(([term, count]) => ({ term, count })).sort((a, b) => b.count - a.count).slice(0, 32);

  const busiest = byDay.reduce((m, d) => (d.count > m.count ? d : m), { date: "—", count: 0 });
  return {
    totals: {
      exchanges: exchanges.length,
      sessions: sessions.length,
      words,
      agents: facets.agents.length,
      machines: facets.hosts.length,
      days: dates.length,
      firstDate: dates[0] ?? "",
      lastDate: dates[dates.length - 1] ?? "",
    },
    byAgent,
    byMachine: facets.hosts,
    byDay,
    topKeywords,
    records: {
      avgWords: exchanges.length ? Math.round(words / exchanges.length) : 0,
      busiestDay: busiest.date,
      busiestDayCount: busiest.count,
      topAgent: byAgent[0]?.key ?? "—",
      deepestTurns: exchanges.reduce((m, e) => Math.max(m, e.turns), 0),
    },
  };
}

export async function conversationsAvailable(): Promise<boolean> {
  return vaultAvailable();
}
