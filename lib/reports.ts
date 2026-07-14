import fs from "fs/promises";
import path from "path";
import os from "os";
import type { Accent } from "./accents";
import { readUsage, type UsageEntry } from "./usage";
import { conversationAnalytics } from "./conversations";
import { listMissions } from "./missions";
import { listSchedules } from "./schedules";
import { listWatchers } from "./watchers";
import { listStandings } from "./arena";
import { getEvalData } from "./evals";
import { readTasks } from "./tasks";
import { listItems as listPipelineItems } from "./pipeline";
import { listContent } from "./content";
import { listOrchestrations } from "./orchestrator";
import { readState as readImportState } from "./llmImport";
import { readMemory, readGoals, readJournal, todayStamp, vaultInfo, vaultAvailable } from "./vault";

/**
 * Reports engine — every report reduces the OS's data stores (usage ledger,
 * vault, missions, arena, evals, pipeline…) into one uniform shape:
 * KPIs + charts + tables + notes. One generic UI renders all of them, one
 * generic serializer exports any of them as Markdown (download, HTML, or a
 * note in the vault under Agentic OS/Reports/).
 *
 * Builders are resilient by design: a missing data file or unreachable vault
 * yields zeros/empty sections, never a throw.
 */

export interface ReportKpi {
  label: string;
  value: string;
  accent?: Accent;
  hint?: string;
}

export interface ReportChart {
  title: string;
  unit?: string;
  bars: { label: string; value: number }[];
}

export interface ReportTable {
  title: string;
  columns: string[];
  rows: (string | number)[][];
}

export interface ReportData {
  id: string;
  title: string;
  tagline: string;
  category: string;
  accent: Accent;
  generatedAt: number;
  kpis: ReportKpi[];
  charts: ReportChart[];
  tables: ReportTable[];
  notes: string[];
}

export interface ReportDef {
  id: string;
  title: string;
  tagline: string;
  category: "operations" | "brain" | "quality" | "output";
  accent: Accent;
}

export const REPORT_DEFS: ReportDef[] = [
  { id: "executive-brief", title: "Executive Brief", tagline: "The whole OS on one page", category: "operations", accent: "cyan" },
  { id: "fleet-performance", title: "Fleet Performance", tagline: "Runs, success & speed per agent", category: "operations", accent: "violet" },
  { id: "cost-spend", title: "Cost & Spend", tagline: "Where the dollars go, and the month-end call", category: "operations", accent: "amber" },
  { id: "reliability", title: "Reliability & Uptime", tagline: "Errors, failures, and clean days", category: "operations", accent: "rose" },
  { id: "model-mix", title: "Model Mix", tagline: "Premium vs. local workload split", category: "operations", accent: "lime" },
  { id: "automations", title: "Automations", tagline: "Schedules & watchers health", category: "operations", accent: "cyan" },
  { id: "conversation-insights", title: "Conversation Insights", tagline: "Who you talk to, when, and how much", category: "brain", accent: "cyan" },
  { id: "topic-landscape", title: "Topic Landscape", tagline: "What the brain is actually about", category: "brain", accent: "magenta" },
  { id: "brain-health", title: "Brain Health", tagline: "Vault size, links, orphans & hubs", category: "brain", accent: "violet" },
  { id: "memory-facts", title: "Memory & Facts", tagline: "The shared memory, audited", category: "brain", accent: "violet" },
  { id: "import-coverage", title: "Import Coverage", tagline: "How much of your history is distilled", category: "brain", accent: "cyan" },
  { id: "writing-rhythm", title: "Writing Rhythm", tagline: "Journal streaks and cadence", category: "brain", accent: "rose" },
  { id: "mission-ops", title: "Mission Operations", tagline: "Strategies, durations & outcomes", category: "quality", accent: "cyan" },
  { id: "arena-standings", title: "Arena Standings", tagline: "Who earns their seat", category: "quality", accent: "rose" },
  { id: "eval-scores", title: "Eval Report Card", tagline: "Scored quality, per model per case", category: "quality", accent: "violet" },
  { id: "productivity", title: "Productivity", tagline: "Tasks, goals & orchestrations shipped", category: "output", accent: "amber" },
  { id: "pipeline-flow", title: "Pipeline Flow", tagline: "Inbox → shipped conversion", category: "output", accent: "magenta" },
  { id: "content-seo", title: "Content & SEO", tagline: "Articles, scores & publishing", category: "output", accent: "lime" },
];

const DAY = 86_400_000;
const num = (n: number, d = 0) => n.toLocaleString("en-US", { maximumFractionDigits: d });
const usd = (n: number) => `$${n.toFixed(2)}`;
const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—");
const when = (ts?: number) =>
  ts ? new Date(ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) : "—";

function skeleton(def: ReportDef): ReportData {
  return { ...def, generatedAt: Date.now(), kpis: [], charts: [], tables: [], notes: [] };
}

/** Per-agent rollup of the usage ledger. */
function usageByAgent(entries: UsageEntry[]) {
  const by = new Map<string, { runs: number; ok: number; ms: number; cost: number; tokens: number }>();
  for (const e of entries) {
    const a = by.get(e.agent) ?? { runs: 0, ok: 0, ms: 0, cost: 0, tokens: 0 };
    a.runs++;
    if (e.ok) a.ok++;
    a.ms += e.ms;
    a.cost += e.costUsd ?? 0;
    a.tokens += e.tokensOut ?? 0;
    by.set(e.agent, a);
  }
  return [...by.entries()].map(([agent, a]) => ({ agent, ...a })).sort((x, y) => y.runs - x.runs);
}

function dailySeries(entries: UsageEntry[], days: number, pick: (e: UsageEntry) => number) {
  const start = new Date().setHours(0, 0, 0, 0) - (days - 1) * DAY;
  const out: { label: string; value: number }[] = [];
  for (let i = 0; i < days; i++) {
    const s = start + i * DAY;
    const d = new Date(s);
    out.push({
      label: `${d.getMonth() + 1}/${d.getDate()}`,
      value: entries.filter((e) => e.ts >= s && e.ts < s + DAY).reduce((n, e) => n + pick(e), 0),
    });
  }
  return out;
}

/** Wikilink graph over the vault: note/link/orphan/hub counts, top hubs. */
async function graphStats() {
  const empty = { notes: 0, links: 0, orphans: 0, hubs: [] as { name: string; links: number }[], folders: new Map<string, number>() };
  const { base } = vaultInfo();
  if (!base || !(await vaultAvailable())) return empty;
  try {
    const { collectVaultFiles } = await import("./vaultSearch");
    const files = (await collectVaultFiles(base)).slice(0, 600);
    const inbound = new Map<string, number>();
    const outbound = new Map<string, number>();
    const names = new Set(files.map((f) => path.basename(f, ".md").toLowerCase()));
    let links = 0;
    for (const f of files) {
      const rel = path.relative(base, f);
      const folder = rel.split(/[\\/]/).slice(0, -1).join("/") || "(root)";
      empty.folders.set(folder, (empty.folders.get(folder) ?? 0) + 1);
      let text = "";
      try {
        text = await fs.readFile(f, "utf8");
      } catch {
        continue;
      }
      const outs = [...text.matchAll(/\[\[([^\]|#]+)/g)].map((m) => m[1].trim().toLowerCase()).filter((t) => names.has(t));
      outbound.set(rel, outs.length);
      links += outs.length;
      for (const t of outs) inbound.set(t, (inbound.get(t) ?? 0) + 1);
    }
    const orphans = files.filter((f) => {
      const rel = path.relative(base, f);
      return (outbound.get(rel) ?? 0) === 0 && (inbound.get(path.basename(f, ".md").toLowerCase()) ?? 0) === 0;
    }).length;
    const hubs = [...inbound.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, n]) => ({ name, links: n }));
    return { notes: files.length, links, orphans, hubs, folders: empty.folders };
  } catch {
    return empty;
  }
}

/** Journal streak, mirroring the Journal page's rule (today pending ≠ broken). */
function streakOf(dates: string[], today: string): number {
  const set = new Set(dates);
  const cursor = new Date(`${today}T12:00:00`);
  const stamp = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  if (!set.has(stamp(cursor))) cursor.setDate(cursor.getDate() - 1);
  let n = 0;
  while (set.has(stamp(cursor))) {
    n++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return n;
}

// ─── builders ───────────────────────────────────────────────────────────────

type Builder = (def: ReportDef) => Promise<ReportData>;

const buildFleetPerformance: Builder = async (def) => {
  const r = skeleton(def);
  const entries = await readUsage(30).catch(() => [] as UsageEntry[]);
  const agents = usageByAgent(entries);
  const ok = entries.filter((e) => e.ok).length;
  const avgMs = entries.length ? entries.reduce((n, e) => n + e.ms, 0) / entries.length : 0;
  r.kpis = [
    { label: "Runs · 30d", value: num(entries.length), accent: "cyan" },
    { label: "Success rate", value: pct(ok, entries.length), accent: "lime" },
    { label: "Avg latency", value: `${(avgMs / 1000).toFixed(1)}s`, accent: "violet" },
    { label: "Active agents", value: num(agents.length), accent: "amber" },
  ];
  r.charts = [{ title: "Runs per day (14d)", bars: dailySeries(entries, 14, () => 1) }];
  r.tables = [
    {
      title: "Per agent (30 days)",
      columns: ["Agent", "Runs", "Success", "Avg s", "Tokens out", "Spend"],
      rows: agents.map((a) => [a.agent, a.runs, pct(a.ok, a.runs), (a.ms / a.runs / 1000).toFixed(1), num(a.tokens), usd(a.cost)]),
    },
  ];
  if (agents[0]) r.notes.push(`Workhorse: **${agents[0].agent}** with ${num(agents[0].runs)} runs (${pct(agents[0].runs, entries.length)} of all traffic).`);
  return r;
};

const buildCostSpend: Builder = async (def) => {
  const r = skeleton(def);
  const entries = await readUsage(30).catch(() => [] as UsageEntry[]);
  const spend = entries.reduce((n, e) => n + (e.costUsd ?? 0), 0);
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const mtd = entries.filter((e) => e.ts >= monthStart).reduce((n, e) => n + (e.costUsd ?? 0), 0);
  const avg7 = entries.filter((e) => e.ts > Date.now() - 7 * DAY).reduce((n, e) => n + (e.costUsd ?? 0), 0) / 7;
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const projected = mtd + avg7 * Math.max(0, daysInMonth - now.getDate());
  const paid = entries.filter((e) => (e.costUsd ?? 0) > 0);
  const okPaid = paid.filter((e) => e.ok);
  const agents = usageByAgent(entries).filter((a) => a.cost > 0);
  r.kpis = [
    { label: "Spend · 30d", value: usd(spend), accent: "amber" },
    { label: "Month to date", value: usd(mtd), accent: "amber" },
    { label: "Month-end ≈", value: usd(projected), accent: "rose", hint: "MTD + last-7-day pace" },
    { label: "Cost / successful run", value: okPaid.length ? usd(spend / okPaid.length) : "—", accent: "lime" },
  ];
  r.charts = [{ title: "Spend per day (14d)", unit: "$", bars: dailySeries(entries, 14, (e) => e.costUsd ?? 0) }];
  r.tables = [
    {
      title: "Spend by agent",
      columns: ["Agent", "Spend", "Share", "Runs", "$ / run"],
      rows: agents.map((a) => [a.agent, usd(a.cost), pct(a.cost, spend), a.runs, usd(a.cost / a.runs)]),
    },
  ];
  const free = entries.length - paid.length;
  r.notes.push(`${pct(free, entries.length)} of runs cost $0 (local models & keyless endpoints).`);
  return r;
};

const buildReliability: Builder = async (def) => {
  const r = skeleton(def);
  const entries = await readUsage(30).catch(() => [] as UsageEntry[]);
  const fails = entries.filter((e) => !e.ok);
  const schedules = await listSchedules().catch(() => []);
  const failedSch = schedules.filter((s) => s.lastStatus && s.lastStatus !== "ok");
  const daily = dailySeries(entries, 14, (e) => (e.ok ? 0 : 1));
  const cleanDays = daily.filter((d) => d.value === 0).length;
  r.kpis = [
    { label: "Error rate · 30d", value: pct(fails.length, entries.length), accent: fails.length ? "rose" : "lime" },
    { label: "Failures", value: num(fails.length), accent: "rose" },
    { label: "Clean days / 14", value: `${cleanDays}`, accent: "lime" },
    { label: "Host uptime", value: `${Math.floor(os.uptime() / 3600)}h`, accent: "cyan", hint: os.hostname() },
  ];
  r.charts = [{ title: "Failures per day (14d)", bars: daily }];
  const worst = usageByAgent(entries)
    .map((a) => ({ ...a, failRate: a.runs ? (a.runs - a.ok) / a.runs : 0 }))
    .filter((a) => a.runs - a.ok > 0)
    .sort((x, y) => y.failRate - x.failRate);
  r.tables = [
    {
      title: "Failures by agent",
      columns: ["Agent", "Runs", "Failed", "Fail rate"],
      rows: worst.map((a) => [a.agent, a.runs, a.runs - a.ok, pct(a.runs - a.ok, a.runs)]),
    },
    {
      title: "Schedules with a failing last run",
      columns: ["Schedule", "Frequency", "Last status", "Next run"],
      rows: failedSch.map((s) => [s.title, s.freq, s.lastStatus ?? "—", when(s.nextRun)]),
    },
  ];
  if (!failedSch.length) r.notes.push("All schedules' last runs succeeded.");
  return r;
};

const buildModelMix: Builder = async (def) => {
  const r = skeleton(def);
  const entries = await readUsage(30).catch(() => [] as UsageEntry[]);
  const agents = usageByAgent(entries);
  const paidRuns = entries.filter((e) => (e.costUsd ?? 0) > 0).length;
  const localRuns = entries.length - paidRuns;
  const byKind = new Map<string, number>();
  for (const e of entries) byKind.set(e.kind, (byKind.get(e.kind) ?? 0) + 1);
  r.kpis = [
    { label: "Local / free runs", value: pct(localRuns, entries.length), accent: "lime" },
    { label: "Premium runs", value: pct(paidRuns, entries.length), accent: "amber" },
    { label: "Models in rotation", value: num(agents.length), accent: "violet" },
    { label: "Chat vs mission", value: `${byKind.get("chat") ?? 0} / ${byKind.get("mission") ?? 0}`, accent: "cyan" },
  ];
  r.charts = [
    {
      title: "Share of runs by model",
      bars: agents.slice(0, 10).map((a) => ({ label: a.agent, value: a.runs })),
    },
  ];
  r.notes.push(
    "A healthy mix routes simple work to free/local models and saves premium calls for hard tasks — crown easy Arena battles to push this further.",
  );
  return r;
};

const buildAutomations: Builder = async (def) => {
  const r = skeleton(def);
  const schedules = await listSchedules().catch(() => []);
  const watchers = await listWatchers().catch(() => []);
  const enabled = schedules.filter((s) => s.enabled);
  const next = enabled.filter((s) => s.nextRun > 0).sort((a, b) => a.nextRun - b.nextRun)[0];
  r.kpis = [
    { label: "Schedules", value: `${enabled.length} on / ${schedules.length}`, accent: "lime" },
    { label: "Watchers", value: `${watchers.filter((w) => w.enabled).length} on / ${watchers.length}`, accent: "amber" },
    { label: "→ Telegram", value: num(enabled.filter((s) => s.deliver === "telegram").length), accent: "magenta" },
    { label: "Next run", value: next ? when(next.nextRun) : "—", accent: "violet", hint: next?.title },
  ];
  r.tables = [
    {
      title: "Schedules",
      columns: ["Title", "Freq", "On", "Deliver", "Last status", "Next run"],
      rows: schedules.map((s) => [s.title, s.freq, s.enabled ? "✓" : "—", s.deliver, s.lastStatus ?? "—", when(s.nextRun)]),
    },
    {
      title: "Watchers",
      columns: ["Name", "Type", "On", "Last fired"],
      rows: watchers.map((w) => [w.name, w.type, w.enabled ? "✓" : "—", w.lastFired ? when(w.lastFired) : "never"]),
    },
  ];
  return r;
};

const buildConversationInsights: Builder = async (def) => {
  const r = skeleton(def);
  const a = await conversationAnalytics().catch(() => null);
  if (!a) {
    r.notes.push("Vault unreachable — no conversation data.");
    return r;
  }
  r.kpis = [
    { label: "Exchanges", value: num(a.totals.exchanges), accent: "cyan" },
    { label: "Sessions", value: num(a.totals.sessions), accent: "violet" },
    { label: "Words", value: num(a.totals.words), accent: "magenta" },
    { label: "Active days", value: num(a.totals.days), accent: "lime", hint: `${a.totals.firstDate} → ${a.totals.lastDate}` },
  ];
  r.charts = [
    { title: "Exchanges by day (last 14 with data)", bars: a.byDay.slice(-14).map((d) => ({ label: d.date.slice(5), value: d.count })) },
    { title: "Exchanges by agent", bars: a.byAgent.slice(0, 8).map((x) => ({ label: x.key, value: x.count })) },
  ];
  r.tables = [
    {
      title: "By agent",
      columns: ["Agent", "Exchanges", "Words"],
      rows: a.byAgent.map((x) => [x.key, x.count, num(x.words)]),
    },
    {
      title: "By machine",
      columns: ["Machine", "Exchanges"],
      rows: a.byMachine.map((x) => [x.key, x.count]),
    },
  ];
  r.notes.push(
    `Records: busiest day **${a.records.busiestDay}** (${a.records.busiestDayCount} exchanges) · deepest thread ${a.records.deepestTurns} turns · avg ${a.records.avgWords} words/exchange · top agent **${a.records.topAgent}**.`,
  );
  return r;
};

const buildTopicLandscape: Builder = async (def) => {
  const r = skeleton(def);
  const a = await conversationAnalytics().catch(() => null);
  if (!a) {
    r.notes.push("Vault unreachable — no conversation data.");
    return r;
  }
  r.kpis = [
    { label: "Distinct topics tracked", value: num(a.topKeywords.length), accent: "magenta" },
    { label: "Top topic", value: a.topKeywords[0]?.term ?? "—", accent: "cyan", hint: a.topKeywords[0] ? `${a.topKeywords[0].count} conversations` : undefined },
    { label: "Conversations mined", value: num(a.totals.exchanges), accent: "violet" },
  ];
  r.charts = [{ title: "Topic frequency (top 16)", bars: a.topKeywords.slice(0, 16).map((k) => ({ label: k.term, value: k.count })) }];
  r.tables = [
    {
      title: "All tracked topics",
      columns: ["Topic", "Conversations"],
      rows: a.topKeywords.map((k) => [k.term, k.count]),
    },
  ];
  r.notes.push("Topics are document-frequency keywords from your side of every conversation — what you actually keep bringing up.");
  return r;
};

const buildBrainHealth: Builder = async (def) => {
  const r = skeleton(def);
  const g = await graphStats();
  r.kpis = [
    { label: "Notes", value: num(g.notes), accent: "violet" },
    { label: "Wikilinks", value: num(g.links), accent: "cyan" },
    { label: "Orphans", value: num(g.orphans), accent: g.orphans > g.notes / 3 ? "rose" : "lime", hint: "no links in or out" },
    { label: "Links / note", value: g.notes ? (g.links / g.notes).toFixed(1) : "—", accent: "magenta" },
  ];
  r.charts = [
    { title: "Top hubs (inbound links)", bars: g.hubs.map((h) => ({ label: h.name, value: h.links })) },
    {
      title: "Notes by folder",
      bars: [...g.folders.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([f, n]) => ({ label: f, value: n })),
    },
  ];
  r.notes.push("Hubs are what agents' link-aware retrieval follows; orphans are invisible to it. The weekly Vault Librarian synthesis is the standing cure for orphans.");
  return r;
};

const buildMemoryFacts: Builder = async (def) => {
  const r = skeleton(def);
  const memory = await readMemory().catch(() => "");
  const lines = memory.split(/\r?\n/).filter((l) => l.trim().startsWith("- "));
  const bySource = new Map<string, number>();
  for (const l of lines) {
    const m = l.match(/·\s*(?:\[\[)?([^\]\ated·]+?)(?:\]\])?\s*\]/);
    const src = m?.[1]?.trim() || "unattributed";
    bySource.set(src, (bySource.get(src) ?? 0) + 1);
  }
  r.kpis = [
    { label: "Facts", value: num(lines.length), accent: "violet" },
    { label: "Size", value: `${(memory.length / 1024).toFixed(1)}kb`, accent: "cyan" },
    { label: "Contributors", value: num(bySource.size), accent: "lime" },
  ];
  r.charts = [
    {
      title: "Facts by contributor",
      bars: [...bySource.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([s, n]) => ({ label: s, value: n })),
    },
  ];
  r.tables = [
    {
      title: "Most recent facts",
      columns: ["Fact"],
      rows: lines.slice(-8).reverse().map((l) => [l.replace(/^- /, "").slice(0, 140)]),
    },
  ];
  r.notes.push("Every agent reads this file before answering; keep it factual and prune anything stale — it's injected into every conversation.");
  return r;
};

const buildImportCoverage: Builder = async (def) => {
  const r = skeleton(def);
  const s = await readImportState().catch(() => null);
  const convos = s?.conversations ?? [];
  const processed = convos.filter((c) => c.processed).length;
  const bySource = new Map<string, { total: number; done: number }>();
  for (const c of convos) {
    const b = bySource.get(c.source) ?? { total: 0, done: 0 };
    b.total++;
    if (c.processed) b.done++;
    bySource.set(c.source, b);
  }
  r.kpis = [
    { label: "Conversations scanned", value: num(convos.length), accent: "cyan" },
    { label: "Distilled", value: num(processed), accent: "lime" },
    { label: "Coverage", value: pct(processed, convos.length), accent: processed === convos.length && convos.length > 0 ? "lime" : "amber" },
    { label: "Words in archive", value: num(convos.reduce((n, c) => n + c.wordCount, 0)), accent: "magenta" },
  ];
  r.tables = [
    {
      title: "By source",
      columns: ["Source", "Scanned", "Distilled", "Coverage"],
      rows: [...bySource.entries()].map(([src, b]) => [src, b.total, b.done, pct(b.done, b.total)]),
    },
    {
      title: "Richest undistilled conversations",
      columns: ["Title", "Source", "Messages", "Words"],
      rows: convos
        .filter((c) => !c.processed)
        .sort((a, b) => b.wordCount - a.wordCount)
        .slice(0, 8)
        .map((c) => [c.title.slice(0, 60), c.source, c.messageCount, num(c.wordCount)]),
    },
  ];
  if (!convos.length) r.notes.push("Nothing scanned yet — drop your ChatGPT/Claude export ZIPs into Documents\\llm-exports and Scan on /import.");
  return r;
};

const buildWritingRhythm: Builder = async (def) => {
  const r = skeleton(def);
  const today = todayStamp();
  const j = await readJournal(today).catch(() => ({ content: "", dates: [] as string[] }));
  const dates = j.dates.includes(today) ? j.dates : [today, ...j.dates];
  const wrote = j.dates;
  const last30 = wrote.filter((d) => Date.now() - new Date(`${d}T12:00:00`).getTime() < 30 * DAY);
  r.kpis = [
    { label: "Days logged (all time)", value: num(wrote.length), accent: "rose" },
    { label: "Streak", value: `${streakOf(wrote, today)} days`, accent: "amber" },
    { label: "Days / last 30", value: `${last30.length}`, accent: "lime" },
    { label: "Today", value: j.content.trim() ? `${j.content.trim().split(/\s+/).length} words` : "not yet", accent: "cyan" },
  ];
  const weekday = new Map<number, number>();
  for (const d of wrote) weekday.set(new Date(`${d}T12:00:00`).getDay(), (weekday.get(new Date(`${d}T12:00:00`).getDay()) ?? 0) + 1);
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  r.charts = [{ title: "Entries by weekday", bars: names.map((n, i) => ({ label: n, value: weekday.get(i) ?? 0 })) }];
  r.tables = [
    { title: "Recent entries", columns: ["Date"], rows: dates.slice(0, 10).map((d) => [d]) },
  ];
  return r;
};

const buildMissionOps: Builder = async (def) => {
  const r = skeleton(def);
  const missions = await listMissions().catch(() => []);
  const done = missions.filter((m) => m.status === "done");
  const durations = done.filter((m) => m.finishedAt).map((m) => (m.finishedAt! - m.createdAt) / 1000);
  const byStrategy = new Map<string, number>();
  for (const m of missions) byStrategy.set(m.strategy, (byStrategy.get(m.strategy) ?? 0) + 1);
  const agentUse = new Map<string, number>();
  for (const m of missions) for (const res of m.results) agentUse.set(res.routedTo ?? res.agentId, (agentUse.get(res.routedTo ?? res.agentId) ?? 0) + 1);
  r.kpis = [
    { label: "Missions flown", value: num(missions.length), accent: "cyan" },
    { label: "Success", value: pct(done.length, missions.length), accent: "lime" },
    { label: "Avg duration", value: durations.length ? `${Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)}s` : "—", accent: "violet" },
    { label: "Errors", value: num(missions.filter((m) => m.status === "error").length), accent: "rose" },
  ];
  r.charts = [
    { title: "By strategy", bars: [...byStrategy.entries()].map(([s, n]) => ({ label: s, value: n })) },
    { title: "Seat time by agent", bars: [...agentUse.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([a, n]) => ({ label: a, value: n })) },
  ];
  r.tables = [
    {
      title: "Recent missions",
      columns: ["Mission", "Strategy", "Status", "Agents", "Duration"],
      rows: missions
        .slice(0, 10)
        .map((m) => [m.title.slice(0, 50), m.strategy, m.status, m.results.length, m.finishedAt ? `${Math.round((m.finishedAt - m.createdAt) / 1000)}s` : "—"]),
    },
  ];
  return r;
};

const buildArenaStandings: Builder = async (def) => {
  const r = skeleton(def);
  const standings = await listStandings().catch(() => []);
  const battles = standings.reduce((n, s) => n + s.battles, 0);
  const champ = standings[0];
  r.kpis = [
    { label: "Fighters ranked", value: num(standings.length), accent: "rose" },
    { label: "Votes cast", value: num(standings.reduce((n, s) => n + s.wins, 0)), accent: "amber" },
    { label: "Champion", value: champ?.agentId ?? "—", accent: "lime", hint: champ ? `${champ.wins}/${champ.battles} wins` : undefined },
  ];
  r.charts = [{ title: "Win rate", bars: standings.map((s) => ({ label: s.agentId, value: s.battles ? Math.round((s.wins / s.battles) * 100) : 0 })) }];
  r.tables = [
    {
      title: "Standings",
      columns: ["#", "Fighter", "Wins", "Battles", "Win rate"],
      rows: standings.map((s, i) => [i + 1, s.agentId, s.wins, s.battles, pct(s.wins, s.battles)]),
    },
  ];
  r.notes.push(`These win-rates directly steer the Auto router's picks. Total recorded battle entries: ${num(battles)}.`);
  return r;
};

const buildEvalScores: Builder = async (def) => {
  const r = skeleton(def);
  const data = await getEvalData().catch(() => ({ cases: [], runs: [] }));
  const doneRuns = data.runs.filter((x) => x.status === "done");
  const latest = doneRuns[doneRuns.length - 1];
  r.kpis = [
    { label: "Test cases", value: num(data.cases.length), accent: "violet" },
    { label: "Runs completed", value: num(doneRuns.length), accent: "cyan" },
    { label: "Last run", value: latest ? when(latest.ts) : "never", accent: "lime" },
  ];
  if (latest) {
    const byAgent = new Map<string, { sum: number; n: number }>();
    for (const s of latest.scores) {
      if (s.score === null) continue;
      const a = byAgent.get(s.agentId) ?? { sum: 0, n: 0 };
      a.sum += s.score;
      a.n++;
      byAgent.set(s.agentId, a);
    }
    r.charts = [
      {
        title: "Latest run — avg score (0–10)",
        bars: [...byAgent.entries()].sort((a, b) => b[1].sum / b[1].n - a[1].sum / a[1].n).map(([a, v]) => ({ label: a, value: Math.round((v.sum / v.n) * 10) / 10 })),
      },
    ];
    r.tables = [
      {
        title: "Latest run — every score",
        columns: ["Agent", "Case", "Score", "Notes"],
        rows: latest.scores.map((s) => [
          s.agentId,
          data.cases.find((c) => c.id === s.caseId)?.name ?? s.caseId,
          s.score ?? "—",
          s.notes.slice(0, 60),
        ]),
      },
    ];
  } else {
    r.notes.push("No completed eval runs — pick agents on /evals and run the suite.");
  }
  return r;
};

const buildProductivity: Builder = async (def) => {
  const r = skeleton(def);
  const { tasks } = await readTasks().catch(() => ({ tasks: [], preamble: "" }));
  const goals = await readGoals().catch(() => []);
  const orchs = await listOrchestrations().catch(() => []);
  const doneTasks = tasks.filter((t) => t.status === "done");
  const done7 = doneTasks.filter((t) => Date.now() - t.updatedAt < 7 * DAY);
  const orchDone = orchs.filter((o) => (o as { status?: string }).status === "done");
  r.kpis = [
    { label: "Tasks done / 7d", value: num(done7.length), accent: "lime" },
    { label: "Board", value: `${tasks.filter((t) => t.status === "pending").length}·${tasks.filter((t) => t.status === "in_progress").length}·${doneTasks.length}`, accent: "amber", hint: "pending · in progress · done" },
    { label: "Goals", value: `${goals.filter((g) => g.done).length}/${goals.length}`, accent: "cyan" },
    { label: "Orchestrations shipped", value: `${orchDone.length}/${orchs.length}`, accent: "magenta" },
  ];
  r.tables = [
    {
      title: "Recently completed tasks",
      columns: ["Task", "Completed"],
      rows: doneTasks
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 8)
        .map((t) => [t.title.slice(0, 70), when(t.updatedAt)]),
    },
    {
      title: "Open goals",
      columns: ["Goal"],
      rows: goals.filter((g) => !g.done).slice(0, 8).map((g) => [g.text.slice(0, 80)]),
    },
  ];
  return r;
};

const buildPipelineFlow: Builder = async (def) => {
  const r = skeleton(def);
  const items = await listPipelineItems().catch(() => []);
  const stages = ["capture", "classify", "gate", "execute", "shipped"] as const;
  const byStage = new Map<string, number>();
  for (const i of items) byStage.set(i.stage, (byStage.get(i.stage) ?? 0) + 1);
  const byType = new Map<string, number>();
  for (const i of items) if (i.type) byType.set(i.type, (byType.get(i.type) ?? 0) + 1);
  const shipped = byStage.get("shipped") ?? 0;
  const confidences = items.filter((i) => i.confidence != null).map((i) => i.confidence!);
  r.kpis = [
    { label: "Items captured", value: num(items.length), accent: "cyan" },
    { label: "Shipped", value: num(shipped), accent: "lime" },
    { label: "Conversion", value: pct(shipped, items.length), accent: "magenta" },
    { label: "Waiting on you", value: num(byStage.get("gate") ?? 0), accent: "amber" },
  ];
  r.charts = [
    { title: "Funnel", bars: stages.map((s) => ({ label: s, value: byStage.get(s) ?? 0 })) },
    { title: "By classified type", bars: [...byType.entries()].map(([t, n]) => ({ label: t, value: n })) },
  ];
  if (confidences.length)
    r.notes.push(`Average classification confidence: ${Math.round(confidences.reduce((a, b) => a + b, 0) / confidences.length)}%.`);
  return r;
};

const buildContentSeo: Builder = async (def) => {
  const r = skeleton(def);
  const items = await listContent().catch(() => []);
  const scored = items.filter((i) => i.status !== "drafting" && i.status !== "error");
  const avgScore = scored.length ? scored.reduce((n, i) => n + i.seoScore, 0) / scored.length : 0;
  const published = items.filter((i) => i.status === "published");
  r.kpis = [
    { label: "Articles", value: num(items.length), accent: "violet" },
    { label: "Avg SEO score", value: scored.length ? `${Math.round(avgScore)}/100` : "—", accent: avgScore >= 80 ? "lime" : "amber" },
    { label: "Published", value: num(published.length), accent: "lime" },
    { label: "Words written", value: num(scored.reduce((n, i) => n + i.wordCount, 0)), accent: "cyan" },
  ];
  r.charts = [{ title: "SEO score per article", bars: scored.slice(0, 12).map((i) => ({ label: i.keyword.slice(0, 18), value: i.seoScore })) }];
  r.tables = [
    {
      title: "Articles",
      columns: ["Title", "Keyword", "Score", "Words", "Status", "Target"],
      rows: items.map((i) => [
        (i.title || i.keyword).slice(0, 45),
        i.keyword.slice(0, 25),
        i.status === "error" ? "—" : i.seoScore,
        i.wordCount || "—",
        i.status,
        i.publishedTo ?? "—",
      ]),
    },
  ];
  return r;
};

const buildExecutiveBrief: Builder = async (def) => {
  const r = skeleton(def);
  const [entries, convos, missions, schedules, standings, items, content] = await Promise.all([
    readUsage(7).catch(() => [] as UsageEntry[]),
    conversationAnalytics().catch(() => null),
    listMissions().catch(() => []),
    listSchedules().catch(() => []),
    listStandings().catch(() => []),
    listPipelineItems().catch(() => []),
    listContent().catch(() => []),
  ]);
  const spend7 = entries.reduce((n, e) => n + (e.costUsd ?? 0), 0);
  const fails = entries.filter((e) => !e.ok).length;
  const missions7 = missions.filter((m) => Date.now() - m.createdAt < 7 * DAY);
  r.kpis = [
    { label: "Runs · 7d", value: num(entries.length), accent: "cyan" },
    { label: "Spend · 7d", value: usd(spend7), accent: "amber" },
    { label: "Error rate", value: pct(fails, entries.length), accent: fails ? "rose" : "lime" },
    { label: "Missions · 7d", value: num(missions7.length), accent: "violet" },
    { label: "Live automations", value: num(schedules.filter((s) => s.enabled).length), accent: "lime" },
    { label: "Champion", value: standings[0]?.agentId ?? "—", accent: "rose" },
  ];
  r.charts = [{ title: "Runs per day (7d)", bars: dailySeries(entries, 7, () => 1) }];
  const busiest = usageByAgent(entries)[0];
  r.notes = [
    busiest ? `Busiest agent this week: **${busiest.agent}** (${busiest.runs} runs, ${pct(busiest.ok, busiest.runs)} success).` : "No runs recorded this week.",
    convos ? `Brain: ${num(convos.totals.exchanges)} conversations across ${convos.totals.agents} agents; top topic "${convos.topKeywords[0]?.term ?? "—"}".` : "Vault unreachable.",
    `Pipeline: ${items.filter((i) => i.stage === "gate").length} item(s) waiting at the Human Gate.`,
    `Content: ${content.length} article(s), ${content.filter((c) => c.status === "published").length} published.`,
  ];
  return r;
};

const BUILDERS: Record<string, Builder> = {
  "executive-brief": buildExecutiveBrief,
  "fleet-performance": buildFleetPerformance,
  "cost-spend": buildCostSpend,
  reliability: buildReliability,
  "model-mix": buildModelMix,
  automations: buildAutomations,
  "conversation-insights": buildConversationInsights,
  "topic-landscape": buildTopicLandscape,
  "brain-health": buildBrainHealth,
  "memory-facts": buildMemoryFacts,
  "import-coverage": buildImportCoverage,
  "writing-rhythm": buildWritingRhythm,
  "mission-ops": buildMissionOps,
  "arena-standings": buildArenaStandings,
  "eval-scores": buildEvalScores,
  productivity: buildProductivity,
  "pipeline-flow": buildPipelineFlow,
  "content-seo": buildContentSeo,
};

export async function buildReport(id: string): Promise<ReportData | null> {
  const def = REPORT_DEFS.find((d) => d.id === id);
  if (!def) return null;
  return BUILDERS[id](def);
}

// ─── export ─────────────────────────────────────────────────────────────────

export function reportMarkdown(r: ReportData): string {
  const lines: string[] = [
    "---",
    "type: report",
    `report: ${r.id}`,
    `date: ${todayStamp()}`,
    "---",
    "",
    `# ${r.title}`,
    "",
    `_${r.tagline} · generated ${new Date(r.generatedAt).toLocaleString("en-US", { hour12: false })} on ${os.hostname()}_`,
    "",
  ];
  if (r.kpis.length) {
    lines.push("| " + r.kpis.map((k) => k.label).join(" | ") + " |");
    lines.push("| " + r.kpis.map(() => "---").join(" | ") + " |");
    lines.push("| " + r.kpis.map((k) => `**${k.value}**`).join(" | ") + " |", "");
  }
  for (const c of r.charts) {
    if (!c.bars.length) continue;
    const max = Math.max(...c.bars.map((b) => b.value), 1);
    lines.push(`## ${c.title}`, "");
    for (const b of c.bars) {
      const blocks = Math.round((b.value / max) * 20);
      lines.push(`- \`${"█".repeat(blocks).padEnd(20, "·")}\` ${b.label} — ${c.unit === "$" ? usd(b.value) : num(b.value, 1)}`);
    }
    lines.push("");
  }
  for (const t of r.tables) {
    if (!t.rows.length) continue;
    lines.push(`## ${t.title}`, "", "| " + t.columns.join(" | ") + " |", "| " + t.columns.map(() => "---").join(" | ") + " |");
    for (const row of t.rows) lines.push("| " + row.map((c) => String(c).replace(/\|/g, "／")).join(" | ") + " |");
    lines.push("");
  }
  if (r.notes.length) {
    lines.push("## Notes", "");
    for (const n of r.notes) lines.push(`- ${n}`);
    lines.push("");
  }
  return lines.join("\n");
}

/** Save a report as a vault note under Agentic OS/Reports/. Returns the filename. */
export async function saveReportToVault(r: ReportData): Promise<string> {
  // vaultInfo().base already points INSIDE "Agentic OS" — don't join it again.
  const { base } = vaultInfo();
  if (!base || !(await vaultAvailable())) throw new Error("Vault unreachable — check VAULT_DIR.");
  const dir = path.join(base, "Reports");
  await fs.mkdir(dir, { recursive: true });
  const name = `${r.title} ${todayStamp()}.md`;
  await fs.writeFile(path.join(dir, name), reportMarkdown(r), "utf8");
  return name;
}
