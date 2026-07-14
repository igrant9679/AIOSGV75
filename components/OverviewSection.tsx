"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { ACCENTS, type Accent } from "@/lib/accents";
import Panel from "./ui/Panel";
import DeepSpaceScan from "./DeepSpaceScan";
import StatusOrb from "./ui/StatusOrb";
import NumberTicker from "./ui/NumberTicker";
import Avatar, { type AvatarKind } from "./Avatar";
import SystemVitals from "./SystemVitals";
import EventFeed from "./EventFeed";
import AttentionPanel from "./AttentionPanel";
import { useMission } from "./store";

interface UsageLite {
  ts: number;
  agent: string;
  ok: boolean;
}

function agoShort(ts: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/** Stat tile with a soft accent glow bleeding in from the top-right corner. */
function GlowTile({ accent, label, value, children }: { accent: Accent; label: string; value: ReactNode; children?: ReactNode }) {
  const c = ACCENTS[accent];
  return (
    <div
      className="relative overflow-hidden rounded-xl border border-line p-3"
      style={{ background: `radial-gradient(130px 80px at 100% 0%, ${c.soft}, transparent 70%)` }}
    >
      <p className="panel-title">{label}</p>
      <p className="mt-1 font-mono text-2xl font-bold" style={{ color: c.base }}>
        {value}
      </p>
      {children && <div className="mt-2 flex h-4 items-center">{children}</div>}
    </div>
  );
}

/** Circular gauge — fill fraction of responders that are up. */
function RingGauge({ value, total, color }: { value: number; total: number; color: string }) {
  const pct = total > 0 ? value / total : 1;
  const r = 24;
  const circ = 2 * Math.PI * r;
  return (
    <div className="relative h-16 w-16 shrink-0">
      <svg viewBox="0 0 60 60" className="h-16 w-16 -rotate-90">
        <circle cx="30" cy="30" r={r} fill="none" stroke="var(--color-line)" strokeWidth="5" />
        <circle
          cx="30"
          cy="30"
          r={r}
          fill="none"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - pct)}
          style={{ stroke: color, transition: "stroke-dashoffset 0.7s ease" }}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-mono text-[11px] font-bold" style={{ color }}>
        {Math.round(pct * 100)}%
      </span>
    </div>
  );
}

export default function OverviewSection() {
  const { system, agents, claudeStats, busy, registry } = useMission();
  const [usage, setUsage] = useState<UsageLite[]>([]);
  const [queue, setQueue] = useState(0);

  useEffect(() => {
    const load = async () => {
      try {
        const [u, m] = await Promise.all([fetch("/api/usage?days=7"), fetch("/api/missions")]);
        if (u.ok) setUsage((((await u.json()) as { entries: UsageLite[] }).entries ?? []).map(({ ts, agent, ok }) => ({ ts, agent, ok })));
        if (m.ok) {
          const missions = ((await m.json()) as { missions: { status: string }[] }).missions ?? [];
          setQueue(missions.filter((x) => x.status === "running" || x.status === "pending").length);
        }
      } catch {
        /* ignore */
      }
    };
    load();
    const t = setInterval(load, 45_000);
    return () => clearInterval(t);
  }, []);

  const dayMs = 86_400_000;
  const todayStart = new Date().setHours(0, 0, 0, 0);
  const todayRuns = usage.filter((e) => e.ts >= todayStart);
  const todayErrors = todayRuns.filter((e) => !e.ok).length;

  const fleetActivity = useMemo(() => {
    const byAgent = new Map<string, UsageLite[]>();
    for (const e of usage) {
      const list = byAgent.get(e.agent) ?? [];
      list.push(e);
      byAgent.set(e.agent, list);
    }
    return Array.from(byAgent.entries())
      .map(([agent, list]) => {
        const days = Array.from({ length: 7 }, (_, i) => {
          const start = todayStart - (6 - i) * dayMs;
          return list.filter((e) => e.ts >= start && e.ts < start + dayMs).length;
        });
        const okCount = list.filter((e) => e.ok).length;
        return {
          agent,
          days,
          runs: list.length,
          successPct: list.length ? Math.round((okCount / list.length) * 100) : 100,
          lastTs: Math.max(...list.map((e) => e.ts)),
        };
      })
      .sort((a, b) => b.runs - a.runs);
  }, [usage, todayStart]);

  const fleet = [
    {
      id: "claude",
      name: "Claude",
      role: "Primary operator · CLI bridge",
      accent: "violet" as const,
      online: Boolean(system?.claudeVersion),
      busy: Boolean(busy.claude),
      detail: system?.claudeVersion ?? "waking bridge…",
    },
    ...agents.map((a) => ({
      id: a.id,
      name: a.name,
      role: a.tagline,
      accent: a.accent,
      online: a.available,
      busy: Boolean(busy[a.id]),
      detail: a.available ? (a.version ?? "ready") : `'${a.binary}' not found`,
    })),
  ];

  const readyLlms = registry.llms.filter((l) => l.hasKey).length;
  const respondersUp = fleet.filter((f) => f.online).length + readyLlms;
  const respondersTotal = fleet.length + registry.llms.length;
  const integrityAccent =
    respondersTotal > 0 && respondersUp === respondersTotal
      ? ACCENTS.lime
      : respondersUp >= respondersTotal / 2
        ? ACCENTS.amber
        : ACCENTS.rose;

  // Today's runs in 2-hour windows → the Ops Pulse sparkline.
  const hourBuckets = Array.from({ length: 12 }, () => 0);
  for (const e of todayRuns) {
    hourBuckets[Math.min(11, Math.floor((e.ts - todayStart) / 7_200_000))]++;
  }
  const maxBucket = Math.max(1, ...hourBuckets);

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <div className="flex flex-col gap-4 xl:col-span-2">
        <SystemVitals />

        <Panel title="Agent Fleet" delay={0.08}>
          <div className="grid gap-3 p-4 md:grid-cols-3">
            {fleet.map((agent, i) => {
              const c = ACCENTS[agent.accent];
              return (
                <motion.div
                  key={agent.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.12 + i * 0.06 }}
                  whileHover={{ y: -3 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <Link
                    href={`/${agent.id}`}
                    className="block cursor-pointer rounded-2xl border border-line bg-white/[0.02] p-4 transition-colors hover:border-line-bright"
                  >
                    <div className="flex items-center justify-between">
                      <Avatar kind={agent.id as AvatarKind} size={38} />
                      <StatusOrb accent={agent.online ? (agent.busy ? "amber" : "lime") : "rose"} size={8} />
                    </div>
                    <p className="mt-3 text-sm font-semibold tracking-wide" style={{ color: c.base }}>
                      {agent.name}
                    </p>
                    <p className="mt-0.5 text-[11px] leading-4 text-ink-faint">{agent.role}</p>
                    <p className="mt-2 truncate font-mono text-[10px] text-ink-dim">{agent.detail}</p>
                  </Link>
                </motion.div>
              );
            })}
          </div>
        </Panel>

        <Panel title="Fleet Activity · 7 Days" delay={0.12}>
          <div className="flex flex-col gap-2 p-4">
            {fleetActivity.length === 0 && (
              <p className="py-4 text-center text-xs text-ink-faint">No recorded runs yet — activity appears after chats, missions, and schedules run.</p>
            )}
            {fleetActivity.map((row) => {
              const known = fleet.find((f) => f.id === row.agent);
              const llm = registry.llms.find((l) => l.id === row.agent);
              const accent = known?.accent ?? llm?.accent ?? "cyan";
              const c = ACCENTS[accent];
              const max = Math.max(1, ...row.days);
              return (
                <div key={row.agent} className="flex items-center gap-3 rounded-xl border border-line bg-white/[0.02] px-3 py-2">
                  <Avatar name={known?.name ?? llm?.name ?? row.agent} kind={known && !llm ? (row.agent as AvatarKind) : undefined} accent={accent} size={28} />
                  <span className="w-20 shrink-0 truncate text-sm font-semibold" style={{ color: c.base }}>
                    {known?.name ?? llm?.name ?? row.agent}
                  </span>
                  <span className="flex flex-1 items-end gap-1" aria-label="7-day activity">
                    {row.days.map((n, i) => (
                      <span
                        key={i}
                        title={`${n} runs`}
                        className="rounded-full"
                        style={{
                          width: 10 + Math.round((n / max) * 8),
                          height: 10 + Math.round((n / max) * 8),
                          background: n > 0 ? c.base : "var(--color-line)",
                          opacity: n > 0 ? 0.4 + 0.6 * (n / max) : 0.6,
                        }}
                      />
                    ))}
                  </span>
                  <span className="w-28 shrink-0 text-right font-mono text-[10px] text-ink-faint">
                    {row.runs} runs · {row.successPct}%
                  </span>
                  <span className="w-14 shrink-0 text-right font-mono text-[10px] text-ink-dim">{agoShort(row.lastTs)} ago</span>
                </div>
              );
            })}
          </div>
        </Panel>

        <EventFeed delay={0.14} />
      </div>

      <div className="flex flex-col gap-4">
        <AttentionPanel delay={0.06} />

        <Panel title="Ops Pulse" delay={0.08}>
          <div className="grid grid-cols-2 gap-3 p-4">
            <GlowTile accent="cyan" label="Queue" value={<NumberTicker value={queue} />}>
              {queue > 0 ? (
                <span className="flex items-center gap-1.5">
                  {Array.from({ length: Math.min(queue, 5) }).map((_, i) => (
                    <span
                      key={i}
                      className="h-2 w-2 animate-pulse rounded-full"
                      style={{ background: ACCENTS.cyan.base, animationDelay: `${i * 160}ms` }}
                    />
                  ))}
                  <span className="font-mono text-[10px] text-ink-faint">live</span>
                </span>
              ) : (
                <span className="font-mono text-[10px] text-ink-faint">idle</span>
              )}
            </GlowTile>

            <GlowTile accent="lime" label="Runs · Today" value={<NumberTicker value={todayRuns.length} />}>
              <span className="flex items-end gap-[3px]" aria-label="today's runs by 2-hour window">
                {hourBuckets.map((n, i) => (
                  <span
                    key={i}
                    title={`${n} runs`}
                    className="w-[5px] rounded-t-sm"
                    style={{
                      height: n === 0 ? 2 : 4 + Math.round((n / maxBucket) * 12),
                      background: n > 0 ? ACCENTS.lime.base : "var(--color-line)",
                      opacity: n > 0 ? 0.5 + 0.5 * (n / maxBucket) : 0.8,
                    }}
                  />
                ))}
              </span>
            </GlowTile>

            <GlowTile
              accent={todayErrors > 0 ? "rose" : "lime"}
              label="Errors · Today"
              value={<NumberTicker value={todayErrors} />}
            >
              <span className="font-mono text-[10px] text-ink-faint">
                {todayErrors > 0
                  ? `${Math.round((todayErrors / Math.max(1, todayRuns.length)) * 100)}% of today's runs`
                  : "clean sheet"}
              </span>
            </GlowTile>

            <div
              className="relative flex items-center gap-3 overflow-hidden rounded-xl border border-line p-3"
              style={{ background: `radial-gradient(130px 80px at 100% 0%, ${integrityAccent.soft}, transparent 70%)` }}
            >
              <RingGauge value={respondersUp} total={respondersTotal} color={integrityAccent.base} />
              <div className="min-w-0">
                <p className="panel-title">Integrity</p>
                <p className="mt-1 font-mono text-lg font-bold" style={{ color: integrityAccent.base }}>
                  {respondersUp}
                  <span className="text-ink-faint">/</span>
                  {respondersTotal}
                </p>
                <p className="font-mono text-[10px] text-ink-faint">responders up</p>
              </div>
            </div>
          </div>
        </Panel>

        <Panel title="Claude Mission Totals" delay={0.16}>
          <div className="grid grid-cols-2 gap-3 p-4">
            <GlowTile accent="cyan" label="Missions" value={<NumberTicker value={claudeStats.runs} />} />
            <GlowTile accent="amber" label="Spend" value={<NumberTicker value={claudeStats.totalCostUsd} decimals={3} prefix="$" />} />
            <GlowTile accent="magenta" label="Tokens Out" value={<NumberTicker value={claudeStats.outputTokens} />} />
            <GlowTile accent="lime" label="Turns" value={<NumberTicker value={claudeStats.turns} />} />
          </div>
        </Panel>
      </div>

      <DeepSpaceScan />
    </div>
  );
}
