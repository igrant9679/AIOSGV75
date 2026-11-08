import { sessionsSnapshot, type SessionSummary, type SubscriptionMeter } from "./sessions";
import { listMissions } from "./missions";
import { listOrchestrations, type Orchestration } from "./orchestrator";
import { collectAttention, type AttentionItem } from "./attention";
import { listExchanges } from "./conversations";
import { readMemory } from "./vault";

/**
 * The hub snapshot behind the five "second brain" pages (Command, Timeline,
 * Projects, Fleet, Board). One normalized activity stream across native
 * sessions (Claude Code, Codex) and Mission Control's own work (chats,
 * missions, orchestrations, approvals, memory), plus the live session list,
 * subscription meters and everything currently blocked on the owner.
 *
 * Read-only. Each source fails soft: a broken source drops out of the stream
 * instead of failing the whole page.
 */

export type ActivitySource = "claude" | "codex" | "chat" | "mission" | "orchestration" | "memory";
export type ActivityStatus = "running" | "waiting" | "idle" | "done" | "error";

export interface ActivityItem {
  id: string;
  ts: number;
  source: ActivitySource;
  agent: string;
  title: string;
  detail?: string;
  project?: string;
  host: string;
  status: ActivityStatus;
  href?: string;
}

export interface MemoryFact {
  ts: number;
  source: string;
  text: string;
}

export interface HubSnapshot {
  host: string;
  generatedAt: number;
  items: ActivityItem[];
  sessions: SessionSummary[];
  subscriptions: SubscriptionMeter[];
  attention: AttentionItem[];
  orchestrations: Orchestration[];
  memory: MemoryFact[];
  indexing: { done: number; total: number };
}

const MEMORY_LINE_RE = /^- \[(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2}) · (?:\[\[(?:[^|\]]*\|)?([^\]]+)\]\]|([^\]]+))\] (.+)$/;

function parseMemory(md: string): MemoryFact[] {
  const out: MemoryFact[] = [];
  for (const line of md.split(/\r?\n/)) {
    const m = line.match(MEMORY_LINE_RE);
    if (!m) continue;
    const [, date, hh, mm, linked, plain, text] = m;
    const ts = new Date(`${date}T${hh}:${mm}:00`).getTime();
    out.push({ ts, source: (linked ?? plain ?? "").trim(), text: text.trim() });
  }
  return out.sort((a, b) => b.ts - a.ts);
}

function exchangeTs(date: string, time: string): number {
  const t = new Date(`${date}T${time || "00:00:00"}`).getTime();
  return Number.isFinite(t) ? t : 0;
}

async function soft<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    return fallback;
  }
}

export async function hubSnapshot(): Promise<HubSnapshot> {
  const [snap, missions, orchestrations, attention, exchanges, memoryMd] = await Promise.all([
    sessionsSnapshot(),
    soft(listMissions(), []),
    soft(listOrchestrations(), []),
    soft(collectAttention(), []),
    soft(listExchanges(), []),
    soft(readMemory(), ""),
  ]);
  const host = snap.host;
  const items: ActivityItem[] = [];

  for (const s of snap.sessions) {
    if (s.indexing) continue;
    items.push({
      id: s.key,
      ts: s.updatedAt,
      source: s.tool,
      agent: s.tool === "claude" ? "Claude Code" : "Codex",
      title: s.title,
      detail: `${s.userTurns} prompt${s.userTurns === 1 ? "" : "s"}${s.model ? ` · ${s.model}` : ""}`,
      project: s.project,
      host: s.host,
      status: s.status === "ended" ? "done" : s.status,
    });
  }

  for (const m of missions) {
    items.push({
      id: `mission:${m.id}`,
      ts: m.finishedAt ?? m.createdAt,
      source: "mission",
      agent: `Mission · ${m.strategy}`,
      title: m.title,
      detail: `${m.agentIds.length} agent${m.agentIds.length === 1 ? "" : "s"}`,
      host,
      status: m.status === "running" ? "running" : m.status === "error" ? "error" : "done",
      href: "/missions",
    });
  }

  for (const o of orchestrations) {
    const reviewing = o.steps.filter((s) => s.status === "review" || s.status === "rework").length;
    items.push({
      id: `orch:${o.id}`,
      ts: o.finishedAt ?? o.createdAt,
      source: "orchestration",
      agent: "Orchestrator",
      title: o.goal.slice(0, 140),
      detail: `${o.steps.length} subtasks${reviewing ? ` · ${reviewing} in review` : ""}`,
      host,
      status: o.status === "done" ? "done" : o.status === "error" ? "error" : "running",
      href: "/board",
    });
  }

  for (const e of exchanges.filter((x) => x.kind === "chat").slice(0, 120)) {
    items.push({
      id: `chat:${e.id}`,
      ts: exchangeTs(e.date, e.time),
      source: "chat",
      agent: e.agent,
      title: e.title.slice(0, 140) || "Chat",
      detail: `${e.turns} turn${e.turns === 1 ? "" : "s"}`,
      host: e.host || host,
      status: "done",
      href: "/conversations",
    });
  }

  const memory = parseMemory(memoryMd);
  for (const f of memory.slice(0, 60)) {
    items.push({
      id: `memory:${f.ts}:${f.text.slice(0, 24)}`,
      ts: f.ts,
      source: "memory",
      agent: f.source || "Memory",
      title: f.text.slice(0, 140),
      detail: "Saved to shared memory",
      host,
      status: "done",
      href: "/memory",
    });
  }

  items.sort((a, b) => b.ts - a.ts);
  return {
    host,
    generatedAt: Date.now(),
    items: items.slice(0, 600),
    sessions: snap.sessions,
    subscriptions: snap.subscriptions,
    attention,
    orchestrations,
    memory: memory.slice(0, 200),
    indexing: snap.indexing,
  };
}
