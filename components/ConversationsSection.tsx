"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import Panel from "./ui/Panel";
import Avatar from "./Avatar";
import Markdown from "./Markdown";
import { IconBook, IconSpark, IconPulse } from "./icons";

const VAULT_NAME = "IdrisGV75";

interface Facet { key: string; count: number }
interface Result {
  id: string;
  agent: string;
  date: string;
  time: string;
  lastTime: string;
  host: string;
  title: string;
  snippet: string;
  turns: number;
  wordCount: number;
  exchangeCount: number;
  file: string;
  body: string;
  score: number;
  summary?: string;
}
interface Payload {
  results: Result[];
  facets: { agents: Facet[]; hosts: Facet[]; dates: Facet[] };
  total: number;
  group: string;
  vaultOk: boolean;
}
interface Analytics {
  totals: { exchanges: number; sessions: number; words: number; agents: number; machines: number; days: number; firstDate: string; lastDate: string };
  byAgent: { key: string; count: number; words: number }[];
  byMachine: { key: string; count: number }[];
  byDay: { date: string; count: number }[];
  topKeywords: { term: string; count: number }[];
  records: { avgWords: number; busiestDay: string; busiestDayCount: number; topAgent: string; deepestTurns: number };
  vaultOk: boolean;
}

const inputCls =
  "w-full rounded-lg border border-line bg-panel-2 px-3 py-2.5 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-line-bright";
const labelCls = "mb-1 block font-mono text-[10px] tracking-[0.14em] text-ink-faint";

function relTime(date: string, time: string): string {
  const t = Date.parse(`${date}T${time}`);
  if (Number.isNaN(t)) return "";
  const days = Math.floor((Date.now() - t) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function highlight(text: string, q: string) {
  const terms = q.trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return text;
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "ig");
  return text.split(re).map((part, i) =>
    terms.some((t) => t.toLowerCase() === part.toLowerCase()) ? (
      <mark key={i} className="rounded bg-neon-amber/25 px-0.5 text-ink">{part}</mark>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

export default function ConversationsSection() {
  const [view, setView] = useState<"search" | "analytics">("search");
  const [q, setQ] = useState("");
  const [agent, setAgent] = useState("");
  const [host, setHost] = useState("");
  const [group, setGroup] = useState<"exchange" | "session">("exchange");
  const [data, setData] = useState<Payload | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [summing, setSumming] = useState<string[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);

  const load = useCallback(async (query: string, ag: string, ho: string, gr: string) => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (query.trim()) p.set("q", query.trim());
      if (ag) p.set("agent", ag);
      if (ho) p.set("host", ho);
      p.set("group", gr);
      const res = await fetch(`/api/conversations?${p.toString()}`);
      if (res.ok) setData((await res.json()) as Payload);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => load(q, agent, host, group), 250);
    return () => clearTimeout(t);
  }, [q, agent, host, group, load]);

  useEffect(() => {
    if (view === "analytics" && !analytics) {
      fetch("/api/conversations/analytics").then((r) => r.json()).then(setAnalytics).catch(() => {});
    }
  }, [view, analytics]);

  const results = data?.results ?? [];
  const totalLabel = useMemo(() => {
    if (!data) return "";
    const shown = results.length;
    return data.total > shown ? `${shown} of ${data.total}` : `${data.total}`;
  }, [data, results.length]);

  const summarize = async (ids: string[]) => {
    if (!ids.length) return;
    setSumming((s) => [...s, ...ids]);
    try {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, group }),
      });
      const j = (await res.json()) as { summaries?: Record<string, string> };
      const map = j.summaries ?? {};
      setData((d) => (d ? { ...d, results: d.results.map((r) => (map[r.id] ? { ...r, summary: map[r.id] } : r)) } : d));
    } finally {
      setSumming((s) => s.filter((id) => !ids.includes(id)));
    }
  };

  const unsummarized = results.filter((r) => !r.summary).map((r) => r.id).slice(0, 12);

  const chip = (active: boolean) =>
    `cursor-pointer rounded-full border px-3 py-1 font-mono text-[11px] transition-colors ${
      active ? "border-neon-cyan bg-neon-cyan/10 text-neon-cyan" : "border-line text-ink-dim hover:bg-white/[0.05]"
    }`;
  const seg = (active: boolean) =>
    `cursor-pointer rounded-md px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.1em] transition-colors ${
      active ? "bg-neon-cyan/15 text-neon-cyan" : "text-ink-faint hover:text-ink-dim"
    }`;

  return (
    <div className="flex flex-col gap-4">
      {/* view tabs */}
      <div className="flex gap-2">
        <button onClick={() => setView("search")} className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold transition-colors" style={view === "search" ? { borderColor: "var(--ac-cyan)", background: "rgba(34,211,238,0.1)", color: "var(--ac-cyan)" } : { borderColor: "var(--color-line)", color: "var(--color-ink-dim)" }}>
          <IconBook width={16} height={16} /> Search
        </button>
        <button onClick={() => setView("analytics")} className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold transition-colors" style={view === "analytics" ? { borderColor: "var(--ac-cyan)", background: "rgba(34,211,238,0.1)", color: "var(--ac-cyan)" } : { borderColor: "var(--color-line)", color: "var(--color-ink-dim)" }}>
          <IconPulse width={16} height={16} /> Analytics
        </button>
      </div>

      {view === "search" ? (
        <>
          <Panel title="Search Conversations" right={<span className="font-mono text-[10px] text-ink-faint">across every agent · all machines</span>}>
            <div className="flex flex-col gap-3 p-5">
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search topics or keywords…  e.g. rust ownership, marketing plan" className={inputCls} autoFocus />

              {/* group toggle */}
              <div className="flex items-center gap-1 self-start rounded-lg border border-line p-1">
                <button className={seg(group === "exchange")} onClick={() => setGroup("exchange")}>Exchanges</button>
                <button className={seg(group === "session")} onClick={() => setGroup("session")}>Sessions</button>
              </div>

              {data && (
                <div className="flex flex-col gap-2">
                  {data.facets.agents.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={labelCls + " mb-0 mr-1"}>AGENT</span>
                      <button className={chip(agent === "")} onClick={() => setAgent("")}>all</button>
                      {data.facets.agents.map((f) => (
                        <button key={f.key} className={chip(agent === f.key)} onClick={() => setAgent(agent === f.key ? "" : f.key)}>
                          {f.key} <span className="text-ink-faint">{f.count}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {data.facets.hosts.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={labelCls + " mb-0 mr-1"}>MACHINE</span>
                      <button className={chip(host === "")} onClick={() => setHost("")}>all</button>
                      {data.facets.hosts.map((f) => (
                        <button key={f.key} className={chip(host === f.key)} onClick={() => setHost(host === f.key ? "" : f.key)}>
                          🖥 {f.key} <span className="text-ink-faint">{f.count}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </Panel>

          <Panel
            title="Results"
            delay={0.05}
            right={
              <div className="flex items-center gap-3">
                {unsummarized.length > 0 && (
                  <button onClick={() => summarize(unsummarized)} disabled={summing.length > 0} className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 font-mono text-[10px] text-ink-dim transition-colors hover:bg-white/[0.06] hover:text-neon-violet disabled:opacity-40">
                    <IconSpark width={12} height={12} /> {summing.length > 0 ? "summarizing…" : `summarize ${unsummarized.length}`}
                  </button>
                )}
                <span className="font-mono text-[10px] text-ink-faint">{loading ? "searching…" : totalLabel}</span>
              </div>
            }
          >
            <div className="flex flex-col gap-2 p-4">
              {data && !data.vaultOk && <p className="py-6 text-center text-xs text-neon-rose">Vault not reachable — conversations live in the synced vault.</p>}
              {data && data.vaultOk && results.length === 0 && (
                <p className="py-8 text-center text-xs text-ink-faint">{q.trim() ? `No conversations match “${q}”.` : "No conversations yet — chat with an agent and it's saved here."}</p>
              )}
              {results.map((r) => {
                const isOpen = open === r.id;
                const obsidian = `obsidian://open?vault=${encodeURIComponent(VAULT_NAME)}&file=${encodeURIComponent(r.file)}`;
                const busy = summing.includes(r.id);
                return (
                  <div key={r.id} className="rounded-xl border border-line bg-white/[0.02]">
                    <button onClick={() => setOpen(isOpen ? null : r.id)} className="flex w-full cursor-pointer items-start gap-3 p-3 text-left">
                      <Avatar name={r.agent} accent="cyan" size={30} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-ink">{highlight(r.title, q)}</p>
                        {r.summary ? (
                          <p className="mt-0.5 line-clamp-1 text-[11px] italic leading-4 text-neon-violet">✦ {r.summary}</p>
                        ) : null}
                        <p className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-ink-dim">{highlight(r.snippet, q)}</p>
                        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[9px] text-ink-faint">
                          <span className="font-semibold text-neon-cyan">{r.agent}</span>
                          <span>{r.date}{group === "session" && r.exchangeCount > 1 ? ` · ${r.time}–${r.lastTime}` : ` · ${r.time}`}</span>
                          <span className="text-ink-dim">{relTime(r.date, r.lastTime)}</span>
                          <span className={r.host ? "text-ink-dim" : ""}>🖥 {r.host || "unknown"}</span>
                          {group === "session" && <span className="text-neon-cyan/80">{r.exchangeCount} exchange{r.exchangeCount === 1 ? "" : "s"}</span>}
                          {r.turns > 1 && <span>{r.turns} turns</span>}
                          <span>{r.wordCount} words</span>
                        </p>
                      </div>
                    </button>
                    {isOpen && (
                      <div className="border-t border-line p-4">
                        <div className="max-h-[28rem] overflow-y-auto pr-1">
                          <Markdown>{r.body}</Markdown>
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <a href={obsidian} className="flex cursor-pointer items-center gap-2 rounded-lg border border-line px-3 py-2 text-xs text-ink-dim transition-colors hover:bg-white/[0.06] hover:text-neon-violet">
                            <IconBook width={13} height={13} /> Open in Obsidian
                          </a>
                          {!r.summary && (
                            <button onClick={() => summarize([r.id])} disabled={busy} className="flex cursor-pointer items-center gap-2 rounded-lg border border-line px-3 py-2 text-xs text-ink-dim transition-colors hover:bg-white/[0.06] hover:text-neon-violet disabled:opacity-40">
                              <IconSpark width={13} height={13} /> {busy ? "summarizing…" : "AI summary"}
                            </button>
                          )}
                          <span className="font-mono text-[10px] text-ink-faint">{r.file}</span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Panel>
        </>
      ) : (
        <AnalyticsView analytics={analytics} onTopic={(term) => { setView("search"); setQ(term); }} />
      )}
    </div>
  );
}

function Bars({ data, max, accent }: { data: { key: string; count: number; extra?: string }[]; max: number; accent: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      {data.map((d) => (
        <div key={d.key} className="flex items-center gap-2">
          <span className="w-28 shrink-0 truncate text-right font-mono text-[10px] text-ink-dim">{d.key}</span>
          <div className="h-4 flex-1 overflow-hidden rounded bg-white/[0.05]">
            <div className="h-full rounded" style={{ width: `${max ? (d.count / max) * 100 : 0}%`, background: accent, minWidth: d.count ? "3px" : 0 }} />
          </div>
          <span className="w-20 shrink-0 font-mono text-[10px] text-ink-faint">{d.count}{d.extra ? ` · ${d.extra}` : ""}</span>
        </div>
      ))}
    </div>
  );
}

function AnalyticsView({ analytics, onTopic }: { analytics: Analytics | null; onTopic: (t: string) => void }) {
  if (!analytics) return <Panel title="Analytics"><p className="p-8 text-center text-xs text-ink-faint">Crunching your conversation history…</p></Panel>;
  if (!analytics.vaultOk) return <Panel title="Analytics"><p className="p-8 text-center text-xs text-neon-rose">Vault not reachable.</p></Panel>;
  const { totals, byAgent, byMachine, byDay, topKeywords, records } = analytics;
  const maxDay = Math.max(1, ...byDay.map((d) => d.count));
  const maxAgent = Math.max(1, ...byAgent.map((a) => a.count));
  const maxKw = Math.max(1, ...topKeywords.map((k) => k.count));
  const days = byDay.slice(-45);

  const tiles = [
    { k: "exchanges", v: totals.exchanges },
    { k: "sessions", v: totals.sessions },
    { k: "words", v: totals.words.toLocaleString() },
    { k: "agents", v: totals.agents },
    { k: "machines", v: totals.machines },
    { k: "active days", v: totals.days },
  ];

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Overview" right={<span className="font-mono text-[10px] text-ink-faint">{totals.firstDate} → {totals.lastDate}</span>}>
        <div className="grid grid-cols-3 gap-3 p-5 sm:grid-cols-6">
          {tiles.map((t) => (
            <div key={t.k} className="rounded-xl border border-line bg-white/[0.02] p-3">
              <p className="text-xl font-semibold text-ink">{t.v}</p>
              <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink-faint">{t.k}</p>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-line px-5 py-3 font-mono text-[11px] text-ink-faint">
          <span>avg <span className="text-ink-dim">{records.avgWords}</span> words/chat</span>
          <span>busiest day <span className="text-ink-dim">{records.busiestDay}</span> ({records.busiestDayCount})</span>
          <span>top agent <span className="text-ink-dim">{records.topAgent}</span></span>
          <span>deepest chat <span className="text-ink-dim">{records.deepestTurns}</span> turns</span>
        </div>
      </Panel>

      <Panel title="Activity Over Time" delay={0.05} right={<span className="font-mono text-[10px] text-ink-faint">chats per day</span>}>
        <div className="p-5">
          {days.length === 0 ? (
            <p className="py-6 text-center text-xs text-ink-faint">No activity yet.</p>
          ) : (
            <div className="flex h-32 items-end gap-1">
              {days.map((d) => (
                <div key={d.date} className="group relative flex-1" title={`${d.date}: ${d.count}`}>
                  <div className="w-full rounded-t bg-neon-cyan/70 transition-colors group-hover:bg-neon-cyan" style={{ height: `${(d.count / maxDay) * 100}%`, minHeight: "2px" }} />
                </div>
              ))}
            </div>
          )}
          <div className="mt-1 flex justify-between font-mono text-[9px] text-ink-faint">
            <span>{days[0]?.date}</span>
            <span>{days[days.length - 1]?.date}</span>
          </div>
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="By Agent" delay={0.1}>
          <div className="p-5">
            <Bars data={byAgent.map((a) => ({ key: a.key, count: a.count, extra: `${a.words}w` }))} max={maxAgent} accent="var(--ac-cyan)" />
          </div>
        </Panel>
        <Panel title="By Machine" delay={0.12}>
          <div className="p-5">
            {byMachine.length ? (
              <Bars data={byMachine} max={Math.max(1, ...byMachine.map((m) => m.count))} accent="var(--ac-violet)" />
            ) : (
              <p className="py-4 text-center text-xs text-ink-faint">No machine data.</p>
            )}
            <p className="mt-3 text-[10px] leading-4 text-ink-faint">Older chats show as “unknown”; new ones are tagged with the machine they happened on.</p>
          </div>
        </Panel>
      </div>

      <Panel title="Top Topics" delay={0.15} right={<span className="font-mono text-[10px] text-ink-faint">most-discussed words · click to search</span>}>
        <div className="flex flex-wrap items-center gap-2 p-5">
          {topKeywords.length === 0 ? (
            <p className="py-4 text-center text-xs text-ink-faint">Not enough data yet.</p>
          ) : (
            topKeywords.map((k) => (
              <button
                key={k.term}
                onClick={() => onTopic(k.term)}
                className="cursor-pointer rounded-lg border border-line px-2.5 py-1 text-ink-dim transition-colors hover:border-neon-cyan hover:text-neon-cyan"
                style={{ fontSize: `${11 + Math.round((k.count / maxKw) * 10)}px` }}
                title={`${k.count} conversations`}
              >
                {k.term} <span className="font-mono text-[9px] text-ink-faint">{k.count}</span>
              </button>
            ))
          )}
        </div>
      </Panel>
    </div>
  );
}
