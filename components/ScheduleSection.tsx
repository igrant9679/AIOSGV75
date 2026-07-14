"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { ACCENTS, type Accent } from "@/lib/accents";
import Panel from "./ui/Panel";
import NumberTicker from "./ui/NumberTicker";
import StatusOrb from "./ui/StatusOrb";
import RingGauge from "./ui/RingGauge";

const accentVar = (a: Accent): CSSProperties => ({ "--page-accent": ACCENTS[a].base }) as CSSProperties;

const FREQ_MS: Record<"hourly" | "daily" | "weekly", number> = {
  hourly: 3_600_000,
  daily: 86_400_000,
  weekly: 604_800_000,
};

/** Visual cron calendar over schedules + watchers (create/edit lives on /missions). */

interface Schedule {
  id: string;
  title: string;
  prompt: string;
  strategy: string;
  agentIds: string[];
  freq: "hourly" | "daily" | "weekly";
  time: string;
  weekday?: number;
  deliver: "vault" | "telegram";
  enabled: boolean;
  nextRun: number;
  lastRun?: number;
  lastStatus?: string;
}

interface Watcher {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  lastFired?: number;
}

const FREQ_ACCENT: Record<Schedule["freq"], Accent> = { hourly: "cyan", daily: "lime", weekly: "violet" };
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function rel(ts: number, now: number): string {
  const d = ts - now;
  if (d <= 0) return "due";
  if (d < 3_600_000) return `in ${Math.max(1, Math.round(d / 60_000))}m`;
  if (d < 86_400_000) return `in ${Math.round(d / 3_600_000)}h`;
  return `in ${Math.round(d / 86_400_000)}d`;
}

export default function ScheduleSection() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [watchers, setWatchers] = useState<Watcher[]>([]);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const [s, w] = await Promise.all([fetch("/api/schedules"), fetch("/api/watchers")]);
      if (s.ok) setSchedules(((await s.json()) as { schedules: Schedule[] }).schedules ?? []);
      if (w.ok) setWatchers(((await w.json()) as { watchers: Watcher[] }).watchers ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15_000);
    const clock = setInterval(() => setNow(Date.now()), 20_000);
    return () => {
      clearInterval(t);
      clearInterval(clock);
    };
  }, [load]);

  const patch = async (id: string, body: Record<string, unknown>) => {
    await fetch("/api/schedules", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...body }),
    });
    load();
  };

  const enabled = schedules.filter((s) => s.enabled);
  const next = useMemo(() => {
    const due = enabled.filter((s) => s.nextRun > 0);
    return due.length ? due.reduce((a, b) => (a.nextRun < b.nextRun ? a : b)) : null;
  }, [enabled]);

  const groups: { key: Schedule["freq"]; label: string; sub: string }[] = [
    { key: "hourly", label: "Hourly", sub: "every hour on the tick" },
    { key: "daily", label: "Daily · runs every day", sub: "fixed daily automation" },
    { key: "weekly", label: "Weekly", sub: "one day per week" },
  ];

  /** Which schedules fire on a given calendar day (0..6 days from today). */
  const firesOn = (s: Schedule, dayOffset: number): boolean => {
    if (!s.enabled) return false;
    if (s.freq === "hourly" || s.freq === "daily") return true;
    const d = new Date(now + dayOffset * 86_400_000);
    return d.getDay() === (s.weekday ?? 0);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div style={accentVar("cyan")}>
          <Panel title="Total Jobs">
            <div className="p-4" style={{ background: `radial-gradient(150px 80px at 100% 0%, ${ACCENTS.cyan.soft}, transparent 70%)` }}>
              <span style={{ color: ACCENTS.cyan.base }}>
                <NumberTicker value={schedules.length + watchers.length} className="text-3xl font-bold" />
              </span>
              <p className="pt-1 font-mono text-[10px] tracking-[0.14em] text-ink-faint">
                {schedules.length} SCHEDULES · {watchers.length} WATCHERS
              </p>
            </div>
          </Panel>
        </div>
        <div style={accentVar("lime")}>
          <Panel title="Enabled" delay={0.04}>
            <div className="p-4" style={{ background: `radial-gradient(150px 80px at 100% 0%, ${ACCENTS.lime.soft}, transparent 70%)` }}>
              <span style={{ color: ACCENTS.lime.base }}>
                <NumberTicker value={enabled.length + watchers.filter((w) => w.enabled).length} className="text-3xl font-bold" />
              </span>
              <p className="pt-1 font-mono text-[10px] tracking-[0.14em] text-ink-faint">LIVE AUTOMATIONS</p>
            </div>
          </Panel>
        </div>
        <div style={accentVar("magenta")}>
          <Panel title="Deliveries" delay={0.08}>
            <div className="p-4" style={{ background: `radial-gradient(150px 80px at 100% 0%, ${ACCENTS.magenta.soft}, transparent 70%)` }}>
              <span style={{ color: ACCENTS.magenta.base }}>
                <NumberTicker value={enabled.filter((s) => s.deliver === "telegram").length} className="text-3xl font-bold" />
              </span>
              <p className="pt-1 font-mono text-[10px] tracking-[0.14em] text-ink-faint">TO TELEGRAM · REST TO VAULT</p>
            </div>
          </Panel>
        </div>
        <div style={accentVar("violet")}>
          <Panel title="Next Run" delay={0.12}>
            <div
              className="flex items-center gap-3 p-4"
              style={{ background: `radial-gradient(150px 80px at 100% 0%, ${ACCENTS.violet.soft}, transparent 70%)` }}
            >
              {next && (
                <RingGauge
                  value={FREQ_MS[next.freq] - Math.max(0, next.nextRun - now)}
                  total={FREQ_MS[next.freq]}
                  color={ACCENTS.violet.base}
                  size={56}
                  label={rel(next.nextRun, now).replace("in ", "")}
                />
              )}
              <div className="min-w-0">
                <p className="text-2xl font-bold" style={{ color: ACCENTS.violet.base }}>
                  {next ? rel(next.nextRun, now) : "—"}
                </p>
                <p className="truncate pt-1 font-mono text-[10px] tracking-[0.14em] text-ink-faint">
                  {next ? next.title.toUpperCase() : "NOTHING SCHEDULED"}
                </p>
              </div>
            </div>
          </Panel>
        </div>
      </div>

      {groups.map((g, gi) => {
        const list = schedules.filter((s) => s.freq === g.key);
        if (list.length === 0) return null;
        const gc = ACCENTS[FREQ_ACCENT[g.key]];
        return (
          <div key={g.key} style={accentVar(FREQ_ACCENT[g.key])}>
          <Panel
            title={`${g.label}`}
            right={
              <span className="rounded-full px-2 py-0.5 font-mono text-[10px] font-bold" style={{ background: gc.soft, color: gc.base }}>
                {list.length} JOBS
              </span>
            }
            delay={0.14 + gi * 0.05}
          >
            <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
              {list.map((s) => {
                const c = ACCENTS[FREQ_ACCENT[s.freq]];
                const elapsed = FREQ_MS[s.freq] - Math.max(0, s.nextRun - now);
                return (
                  <div
                    key={s.id}
                    className="rounded-xl border border-line p-3 transition-colors hover:border-line-bright"
                    style={{
                      borderLeft: `3px solid ${c.base}`,
                      background: `radial-gradient(150px 70px at 100% 0%, ${c.soft}, transparent 75%)`,
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[11px]" style={{ color: c.base }}>
                        {s.freq === "hourly" ? "*:00" : s.freq === "weekly" ? `${WEEKDAYS[s.weekday ?? 0]} ${s.time}` : s.time}
                      </span>
                      <span className="flex items-center gap-2">
                        {s.enabled && (
                          <RingGauge value={elapsed} total={FREQ_MS[s.freq]} color={c.base} size={22} label="" />
                        )}
                        <StatusOrb accent={s.enabled ? "lime" : "rose"} pulsing={false} size={7} />
                      </span>
                    </div>
                    <p className="pt-1 text-sm font-semibold text-ink">{s.title}</p>
                    <p className="line-clamp-2 pt-0.5 text-[11px] leading-4 text-ink-faint">{s.prompt}</p>
                    <div className="flex items-center justify-between pt-2">
                      <span className="font-mono text-[10px] text-ink-faint">
                        {s.deliver === "telegram" ? "→ telegram" : "→ vault"} · {s.enabled ? rel(s.nextRun, now) : "off"}
                      </span>
                      <span className="flex gap-1">
                        <button
                          onClick={() => patch(s.id, { runNow: true })}
                          aria-label={`Run ${s.title} now`}
                          className="cursor-pointer rounded-md border border-line px-2 py-0.5 font-mono text-[10px] text-ink-dim transition-colors hover:bg-white/[0.06]"
                        >
                          ▶ run
                        </button>
                        <button
                          onClick={() => patch(s.id, { enabled: !s.enabled })}
                          aria-label={`Toggle ${s.title}`}
                          className="cursor-pointer rounded-md border border-line px-2 py-0.5 font-mono text-[10px] text-ink-dim transition-colors hover:bg-white/[0.06]"
                        >
                          {s.enabled ? "off" : "on"}
                        </button>
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>
          </div>
        );
      })}

      {watchers.length > 0 && (
        <Panel title="Watchers · event-driven" right={<span className="font-mono text-[11px] text-ink-faint">{watchers.length}</span>} delay={0.3}>
          <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
            {watchers.map((w) => (
              <div key={w.id} className="rounded-xl border border-line bg-white/[0.02] p-3" style={{ borderLeft: `3px solid ${ACCENTS.amber.base}` }}>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] text-neon-amber">{w.type}</span>
                  <StatusOrb accent={w.enabled ? "lime" : "rose"} pulsing={false} size={7} />
                </div>
                <p className="pt-1 text-sm font-semibold text-ink">{w.name}</p>
                <p className="pt-2 font-mono text-[10px] text-ink-faint">{w.lastFired ? `last fired ${rel(w.lastFired, now).replace("in ", "")} ago` : "never fired"}</p>
              </div>
            ))}
          </div>
        </Panel>
      )}

      <Panel title="Cron Timeline · next 7 days" delay={0.34}>
        <div className="flex flex-col gap-2 p-4">
          {Array.from({ length: 7 }, (_, i) => {
            const d = new Date(now + i * 86_400_000);
            const todays = enabled.filter((s) => firesOn(s, i));
            const dayPct = ((d.getHours() * 60 + d.getMinutes()) / 1440) * 100;
            return (
              <div
                key={i}
                className={`flex flex-col gap-1 rounded-lg px-2 py-1.5 ${i === 0 ? "border border-line" : ""}`}
                style={i === 0 ? { background: `radial-gradient(300px 60px at 0% 0%, ${ACCENTS.lime.soft}, transparent 80%)` } : undefined}
              >
                <div className="flex items-center gap-3">
                  <span className="w-24 shrink-0 font-mono text-[11px] text-ink-faint">
                    {i === 0 ? <span style={{ color: ACCENTS.lime.base }}>today</span> : WEEKDAYS[d.getDay()]}{" "}
                    <span className="text-ink-dim">{d.getDate()}</span>
                  </span>
                  <span className="flex flex-1 flex-wrap items-center gap-1.5">
                    {todays.length === 0 && <span className="text-[11px] text-ink-faint">—</span>}
                    {todays.map((s) => {
                      const c = ACCENTS[FREQ_ACCENT[s.freq]];
                      return (
                        <span
                          key={s.id}
                          title={`${s.title} · ${s.freq === "hourly" ? "hourly" : s.time}`}
                          className="rounded-full px-2 py-0.5 font-mono text-[10px]"
                          style={{ background: c.soft, color: c.base }}
                        >
                          {s.freq === "hourly" ? "24×" : s.time} {s.title.length > 22 ? s.title.slice(0, 22) + "…" : s.title}
                        </span>
                      );
                    })}
                  </span>
                </div>
                {i === 0 && (
                  <div className="relative ml-24 h-1 overflow-hidden rounded-full" style={{ background: "var(--color-line)" }} aria-label="time of day">
                    <div
                      className="absolute inset-y-0 left-0 rounded-full"
                      style={{ width: `${dayPct}%`, background: `linear-gradient(90deg, ${ACCENTS.lime.gradFrom}, ${ACCENTS.lime.base})` }}
                    />
                    <div
                      className="absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full"
                      style={{ left: `calc(${dayPct}% - 5px)`, background: ACCENTS.lime.base, boxShadow: `0 0 8px ${ACCENTS.lime.glow}` }}
                    />
                  </div>
                )}
              </div>
            );
          })}
          <p className="pt-2 text-[11px] leading-5 text-ink-faint">
            Create or edit schedules from the <span className="font-mono">Missions</span> page launcher (&quot;On a schedule&quot;); watchers from the Watchers panel there.
          </p>
        </div>
      </Panel>
    </div>
  );
}
