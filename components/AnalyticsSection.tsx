"use client";

import { useEffect, useMemo, useState } from "react";
import { ACCENTS, type Accent } from "@/lib/accents";
import type { UsageEntry } from "@/lib/usage";
import Panel from "./ui/Panel";
import NumberTicker from "./ui/NumberTicker";
import Avatar, { type AvatarKind } from "./Avatar";
import { useMission } from "./store";

const DAY = 86_400_000;

function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function Bars({ data, accent, format }: { data: { label: string; value: number }[]; accent: Accent; format: (v: number) => string }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  const c = ACCENTS[accent];
  return (
    <div className="flex h-28 items-end gap-1 px-1">
      {data.map((d, i) => (
        <div key={i} className="group flex min-w-0 flex-1 flex-col items-center gap-1" title={`${d.label}: ${format(d.value)}`}>
          <span className="hidden font-mono text-[8.5px] text-ink-dim group-hover:block">{format(d.value)}</span>
          <div
            className="w-full rounded-t-sm transition-colors"
            style={{
              height: `${Math.max(2, (d.value / max) * 78)}px`,
              background: d.value > 0 ? c.base : "rgba(148,163,255,0.12)",
              opacity: d.value > 0 ? 0.85 : 1,
            }}
          />
          <span className="truncate font-mono text-[8.5px] text-ink-faint">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

export default function AnalyticsSection() {
  const { registry, agents, system } = useMission();
  const [entries, setEntries] = useState<UsageEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/usage?days=30")
      .then((r) => (r.ok ? r.json() : { entries: [] }))
      .then((d: { entries: UsageEntry[] }) => setEntries(d.entries ?? []))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const accentFor = (id: string): Accent => {
    if (id === "claude") return "violet";
    const a = agents.find((x) => x.id === id);
    if (a) return a.accent;
    return registry.llms.find((l) => l.id === id)?.accent ?? "cyan";
  };
  const kindFor = (id: string): AvatarKind | undefined =>
    id === "claude" || id === "openclaw" || id === "hermes" ? (id as AvatarKind) : undefined;

  const stats = useMemo(() => {
    const spend = entries.reduce((s, e) => s + (e.costUsd ?? 0), 0);
    const tokensOut = entries.reduce((s, e) => s + (e.tokensOut ?? 0), 0);
    const avgMs = entries.length ? entries.reduce((s, e) => s + e.ms, 0) / entries.length : 0;
    const today = entries.filter((e) => e.ts > Date.now() - DAY);
    const spendToday = today.reduce((s, e) => s + (e.costUsd ?? 0), 0);

    const byAgent = new Map<string, { runs: number; spend: number; ms: number; tokens: number; fails: number }>();
    for (const e of entries) {
      const a = byAgent.get(e.agent) ?? { runs: 0, spend: 0, ms: 0, tokens: 0, fails: 0 };
      a.runs++;
      a.spend += e.costUsd ?? 0;
      a.ms += e.ms;
      a.tokens += e.tokensOut ?? 0;
      if (!e.ok) a.fails++;
      byAgent.set(e.agent, a);
    }
    const agentRows = [...byAgent.entries()]
      .map(([agent, a]) => ({ agent, ...a, avgMs: a.ms / a.runs }))
      .sort((x, y) => y.runs - x.runs);

    const days: { label: string; runs: number; spend: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const start = Date.now() - i * DAY;
      const key = dayKey(start);
      const dayEntries = entries.filter((e) => dayKey(e.ts) === key && e.ts > Date.now() - 15 * DAY);
      days.push({ label: key, runs: dayEntries.length, spend: dayEntries.reduce((s, e) => s + (e.costUsd ?? 0), 0) });
    }

    return { spend, spendToday, tokensOut, avgMs, runs: entries.length, agentRows, days };
  }, [entries]);

  const maxAgentRuns = Math.max(...stats.agentRows.map((r) => r.runs), 1);

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <div className="flex flex-col gap-4 xl:col-span-2">
        {/* headline stats */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[
            { label: "Spend · 30d", value: <NumberTicker value={stats.spend} decimals={2} prefix="$" />, accent: "amber" },
            { label: "Runs · 30d", value: <NumberTicker value={stats.runs} />, accent: "cyan" },
            { label: "Tokens Out", value: <NumberTicker value={stats.tokensOut} />, accent: "magenta" },
            { label: "Avg Latency", value: <NumberTicker value={stats.avgMs / 1000} decimals={1} suffix="s" />, accent: "lime" },
          ].map((s, i) => (
            <Panel key={s.label} delay={i * 0.04}>
              <div className="px-4 py-3.5">
                <p className="panel-title">{s.label}</p>
                <p className="mt-1 font-mono text-2xl font-bold" style={{ color: ACCENTS[s.accent as Accent].base }}>
                  {s.value}
                </p>
              </div>
            </Panel>
          ))}
        </div>

        <Panel title="Activity — Last 14 Days" delay={0.1}>
          <div className="grid gap-4 p-4 md:grid-cols-2">
            <div>
              <p className="panel-title mb-2">Runs / day</p>
              <Bars data={stats.days.map((d) => ({ label: d.label, value: d.runs }))} accent="cyan" format={(v) => `${v} runs`} />
            </div>
            <div>
              <p className="panel-title mb-2">Spend / day</p>
              <Bars data={stats.days.map((d) => ({ label: d.label, value: d.spend }))} accent="amber" format={(v) => `$${v.toFixed(3)}`} />
            </div>
          </div>
        </Panel>

        <Panel title="By Agent" delay={0.14}>
          <div className="flex flex-col gap-2 p-4">
            {loaded && stats.agentRows.length === 0 && (
              <p className="py-6 text-center text-xs text-ink-faint">No runs recorded yet — chat with an agent or fly a mission.</p>
            )}
            {stats.agentRows.map((r) => {
              const c = ACCENTS[accentFor(r.agent)];
              return (
                <div key={r.agent} className="flex items-center gap-3 rounded-xl border border-line bg-white/[0.02] px-3 py-2.5">
                  <Avatar kind={kindFor(r.agent)} name={r.agent} accent={accentFor(r.agent)} size={28} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate text-sm font-semibold text-ink">{r.agent}</p>
                      <p className="shrink-0 font-mono text-[10px] text-ink-dim">
                        {r.runs} runs · {(r.avgMs / 1000).toFixed(1)}s avg
                        {r.spend > 0 ? ` · $${r.spend.toFixed(2)}` : ""}
                        {r.tokens > 0 ? ` · ${r.tokens.toLocaleString()} tok` : ""}
                        {r.fails > 0 ? ` · ${r.fails} failed` : ""}
                      </p>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/5">
                      <div className="h-full rounded-full" style={{ width: `${(r.runs / maxAgentRuns) * 100}%`, background: c.base }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      </div>

      <div className="flex flex-col gap-4">
        <Panel title="Reading This" delay={0.08}>
          <div className="flex flex-col gap-3 p-4 text-[11.5px] leading-5 text-ink-dim">
            <p>
              Every run is recorded — chats, missions, schedules, and summarizers — with cost and tokens where the
              provider reports them (Claude reports real dollars; API LLMs report tokens).
            </p>
            <p>
              This ledger is the foundation for <span className="text-neon-cyan">smart routing</span>: once there&apos;s
              enough data, an &ldquo;Auto&rdquo; agent can pick the cheapest capable model per task.
            </p>
          </div>
        </Panel>

        <Panel title="Bridge" delay={0.12}>
          <dl className="flex flex-col gap-2.5 p-4 font-mono text-[11px]">
            <div className="flex justify-between">
              <dt className="text-ink-faint">LEDGER</dt>
              <dd className="text-ink-dim">data/usage.json</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-faint">WINDOW</dt>
              <dd className="text-ink-dim">last 30 days</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-faint">CLAUDE CLI</dt>
              <dd className="text-ink-dim">{system?.claudeVersion?.split(" ")[0] ?? "—"}</dd>
            </div>
          </dl>
        </Panel>
      </div>
    </div>
  );
}
