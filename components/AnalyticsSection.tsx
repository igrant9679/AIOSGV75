"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { ACCENTS, type Accent } from "@/lib/accents";
import type { UsageEntry } from "@/lib/usage";
import Panel from "./ui/Panel";
import NumberTicker from "./ui/NumberTicker";
import EmptyState from "./ui/EmptyState";
import Avatar, { type AvatarKind } from "./Avatar";
import { useMission } from "./store";

/** Tiny inline trend — one bar per day, in the stat's accent. */
function TrendSpark({ values, accent }: { values: number[]; accent: Accent }) {
  const c = ACCENTS[accent];
  const max = Math.max(...values, 1);
  return (
    <span className="flex items-end gap-[2px]" aria-hidden>
      {values.map((v, i) => (
        <span
          key={i}
          className="w-[4px] rounded-t-sm"
          style={{
            height: v === 0 ? 2 : 3 + Math.round((v / max) * 11),
            background: v > 0 ? c.base : "var(--color-line)",
            opacity: v > 0 ? 0.45 + 0.55 * (v / max) : 0.8,
          }}
        />
      ))}
    </span>
  );
}

const DAY = 86_400_000;

function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function Bars({
  data,
  accent,
  format,
  refValue,
  refLabel,
}: {
  data: { label: string; value: number }[];
  accent: Accent;
  format: (v: number) => string;
  refValue?: number;
  refLabel?: string;
}) {
  const max = Math.max(...data.map((d) => d.value), refValue ?? 0, 1);
  const c = ACCENTS[accent];
  return (
    <div className="relative">
      {refValue !== undefined && refValue > 0 && (
        <div
          className="pointer-events-none absolute inset-x-1 z-10"
          style={{ bottom: `${14 + (refValue / max) * 78}px` }}
          title={refLabel}
        >
          <div className="border-t border-dashed" style={{ borderColor: c.base, opacity: 0.7 }} />
          {refLabel && (
            <span className="absolute -top-4 right-0 font-mono text-[8.5px]" style={{ color: c.base }}>
              {refLabel}
            </span>
          )}
        </div>
      )}
      <div className="flex h-28 items-end gap-1 px-1">
      {data.map((d, i) => (
        <div key={i} className="group flex min-w-0 flex-1 flex-col items-center gap-1" title={`${d.label}: ${format(d.value)}`}>
          <span className="hidden font-mono text-[8.5px] text-ink-dim group-hover:block">{format(d.value)}</span>
          <div
            className="w-full rounded-t-sm transition-colors"
            style={{
              height: `${Math.max(2, (d.value / max) * 78)}px`,
              background: d.value > 0 ? c.base : "var(--color-line)",
              opacity: d.value > 0 ? 0.85 : 1,
            }}
          />
          <span className="truncate font-mono text-[8.5px] text-ink-faint">{d.label}</span>
        </div>
      ))}
      </div>
    </div>
  );
}

export default function AnalyticsSection() {
  const { registry, agents, system } = useMission();
  const [entries, setEntries] = useState<UsageEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [billing, setBilling] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch("/api/usage?days=30")
      .then((r) => (r.ok ? r.json() : { entries: [] }))
      .then((d: { entries: UsageEntry[] }) => setEntries(d.entries ?? []))
      .catch(() => {})
      .finally(() => setLoaded(true));
    fetch("/api/billing")
      .then((r) => (r.ok ? r.json() : { modes: {} }))
      .then((d: { modes: Record<string, string> }) => setBilling(d.modes ?? {}))
      .catch(() => {});
  }, []);

  /** Only API-key agents represent money actually charged. */
  const isBilledAgent = useCallback((id: string) => billing[id] === "api", [billing]);

  const accentFor = (id: string): Accent => {
    if (id === "claude") return "violet";
    const a = agents.find((x) => x.id === id);
    if (a) return a.accent;
    return registry.llms.find((l) => l.id === id)?.accent ?? "cyan";
  };
  const kindFor = (id: string): AvatarKind | undefined =>
    id === "claude" || id === "openclaw" || id === "hermes" ? (id as AvatarKind) : undefined;

  // Split the ledger: money actually charged (API keys) vs what subscription
  // runs would have cost at list prices. Conflating them overstates spend.
  const split = useMemo(() => {
    const billed = entries.filter((e) => isBilledAgent(e.agent));
    const subbed = entries.filter((e) => billing[e.agent] === "subscription");
    return {
      billedSpend: billed.reduce((s, e) => s + (e.costUsd ?? 0), 0),
      subEstimate: subbed.reduce((s, e) => s + (e.costUsd ?? 0), 0),
      subRuns: subbed.length,
      billedRuns: billed.length,
    };
  }, [entries, billing, isBilledAgent]);

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

    // Month-end projection: month-to-date actuals + last-7-day daily pace for
    // the remaining days. BILLED agents only — projecting a subscription's
    // notional cost as though it were a bill is exactly the lie this avoids.
    const billedEntries = entries.filter((e) => isBilledAgent(e.agent));
    const nowD = new Date();
    const monthStart = new Date(nowD.getFullYear(), nowD.getMonth(), 1).getTime();
    const mtdSpend = billedEntries.filter((e) => e.ts >= monthStart).reduce((s, e) => s + (e.costUsd ?? 0), 0);
    const avg7 = billedEntries.filter((e) => e.ts > Date.now() - 7 * DAY).reduce((s, e) => s + (e.costUsd ?? 0), 0) / 7;
    const daysInMonth = new Date(nowD.getFullYear(), nowD.getMonth() + 1, 0).getDate();
    const projMonthEnd = mtdSpend + avg7 * Math.max(0, daysInMonth - nowD.getDate());

    return { spend, spendToday, tokensOut, avgMs, runs: entries.length, agentRows, days, avg7, projMonthEnd };
  }, [entries, isBilledAgent]);

  const maxAgentRuns = Math.max(...stats.agentRows.map((r) => r.runs), 1);

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <div className="flex flex-col gap-4 xl:col-span-2">
        {/* headline stats — each panel takes its stat's accent + a 14-day trend */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {(
            [
              { label: "API spend · 30d", value: <NumberTicker value={split.billedSpend} decimals={2} prefix="$" />, accent: "amber", trend: stats.days.map((d) => d.spend) },
              { label: "Runs · 30d", value: <NumberTicker value={stats.runs} />, accent: "cyan", trend: stats.days.map((d) => d.runs) },
              { label: "Tokens Out", value: <NumberTicker value={stats.tokensOut} />, accent: "magenta", trend: null },
              { label: "Avg Latency", value: <NumberTicker value={stats.avgMs / 1000} decimals={1} suffix="s" />, accent: "lime", trend: null },
            ] as { label: string; value: ReactNode; accent: Accent; trend: number[] | null }[]
          ).map((s, i) => (
            <div key={s.label} style={{ "--page-accent": ACCENTS[s.accent].base } as CSSProperties}>
              <Panel delay={i * 0.04}>
                <div
                  className="px-4 py-3.5"
                  style={{ background: `radial-gradient(140px 80px at 100% 0%, ${ACCENTS[s.accent].soft}, transparent 70%)` }}
                >
                  <p className="panel-title">{s.label}</p>
                  <p className="mt-1 font-mono text-2xl font-bold" style={{ color: ACCENTS[s.accent].base }}>
                    {s.value}
                  </p>
                  <div className="mt-2 flex h-4 items-center">
                    {s.trend ? (
                      <TrendSpark values={s.trend} accent={s.accent} />
                    ) : (
                      <span className="font-mono text-[9px] tracking-[0.18em] text-ink-faint">30-DAY WINDOW</span>
                    )}
                  </div>
                </div>
              </Panel>
            </div>
          ))}
        </div>

        {split.subRuns > 0 && (
          <div
            className="rounded-xl border px-4 py-2.5 text-[11.5px] leading-5"
            style={{ borderColor: ACCENTS.violet.border, background: ACCENTS.violet.soft }}
          >
            <span className="font-mono text-[10px] tracking-[0.14em]" style={{ color: ACCENTS.violet.base }}>
              SUBSCRIPTION USAGE — NOT BILLED
            </span>
            <p className="pt-1 text-ink-dim">
              {split.subRuns.toLocaleString()} of these runs went to agents on a <span className="text-ink">subscription</span>{" "}
              (your Claude plan). Their notional cost — <span className="font-mono">${split.subEstimate.toFixed(2)}</span> — is an
              estimate at API list prices, <span className="text-ink">not money charged</span>. The real limit there is your
              plan&apos;s usage allowance. Only <span className="text-ink">API spend</span> above reflects actual charges.
            </p>
          </div>
        )}

        <Panel
          title="Activity — Last 14 Days"
          right={
            stats.projMonthEnd > 0 && split.billedSpend > 0 ? (
              <span
                className="rounded-full px-2 py-0.5 font-mono text-[10px] font-bold"
                style={{ background: ACCENTS.amber.soft, color: ACCENTS.amber.base }}
                title="Month-to-date API spend plus the last-7-day daily pace for the remaining days. Subscription runs are excluded."
              >
                MONTH-END ≈ ${stats.projMonthEnd.toFixed(2)}
              </span>
            ) : undefined
          }
          delay={0.1}
        >
          <div className="grid gap-4 p-4 md:grid-cols-2">
            <div>
              <p className="panel-title mb-2">Runs / day</p>
              <Bars data={stats.days.map((d) => ({ label: d.label, value: d.runs }))} accent="cyan" format={(v) => `${v} runs`} />
            </div>
            <div>
              <p className="panel-title mb-2">Spend / day</p>
              <Bars
                data={stats.days.map((d) => ({ label: d.label, value: d.spend }))}
                accent="amber"
                format={(v) => `$${v.toFixed(3)}`}
                refValue={stats.avg7}
                refLabel={`7d pace $${stats.avg7.toFixed(2)}/day`}
              />
            </div>
          </div>
        </Panel>

        <Panel title="By Agent" delay={0.14}>
          <div className="flex flex-col gap-2 p-4">
            {loaded && stats.agentRows.length === 0 && (
              <EmptyState accent="amber" title="No runs recorded" hint="Chat with an agent or fly a mission — every run lands in this ledger." />
            )}
            {stats.agentRows.map((r) => {
              const c = ACCENTS[accentFor(r.agent)];
              return (
                <div key={r.agent} className="flex items-center gap-3 rounded-xl border border-line bg-white/[0.02] px-3 py-2.5">
                  <Avatar kind={kindFor(r.agent)} name={r.agent} accent={accentFor(r.agent)} size={28} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="flex min-w-0 items-baseline gap-2 truncate text-sm font-semibold text-ink">
                        {r.agent}
                        {billing[r.agent] && billing[r.agent] !== "unknown" && (
                          <span
                            className="shrink-0 rounded px-1.5 py-px font-mono text-[8.5px] tracking-[0.1em]"
                            style={
                              billing[r.agent] === "api"
                                ? { background: ACCENTS.amber.soft, color: ACCENTS.amber.base }
                                : billing[r.agent] === "local"
                                  ? { background: ACCENTS.lime.soft, color: ACCENTS.lime.base }
                                  : { background: ACCENTS.violet.soft, color: ACCENTS.violet.base }
                            }
                            title={
                              billing[r.agent] === "api"
                                ? "Billed per token against an API key — real charges."
                                : billing[r.agent] === "local"
                                  ? "Runs on this machine. Free."
                                  : "Runs against a subscription — the cost shown is an estimate at list prices, not a charge."
                            }
                          >
                            {billing[r.agent] === "api" ? "BILLED" : billing[r.agent] === "local" ? "FREE" : "SUBSCRIPTION"}
                          </span>
                        )}
                      </p>
                      <p className="shrink-0 font-mono text-[10px] text-ink-dim">
                        {r.runs} runs · {(r.avgMs / 1000).toFixed(1)}s avg
                        {r.spend > 0 ? (billing[r.agent] === "subscription" ? ` · ~$${r.spend.toFixed(2)} est` : ` · $${r.spend.toFixed(2)}`) : ""}
                        {r.tokens > 0 ? ` · ${r.tokens.toLocaleString()} tok` : ""}
                        {r.fails > 0 ? ` · ${r.fails} failed` : ""}
                      </p>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/5">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${(r.runs / maxAgentRuns) * 100}%`,
                          background: `linear-gradient(90deg, ${c.gradFrom}, ${c.gradTo})`,
                        }}
                      />
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
