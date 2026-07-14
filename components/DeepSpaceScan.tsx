"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ACCENTS, type Accent } from "@/lib/accents";
import Panel from "./ui/Panel";
import NumberTicker from "./ui/NumberTicker";
import { useMission } from "./store";

/**
 * Deep Space Scan — the Overview's live console. Four real, moving reads on the
 * system: a fleet radar whose sweep pings actual agents, per-agent load bars
 * that race and re-sort, a run-health ring, and the machine-group's health.
 */
interface UsageEntry {
  ts: number;
  agent: string;
  ms: number;
  costUsd?: number;
  tokensOut?: number;
  ok: boolean;
}
interface ClusterNode {
  host: string;
  label: string;
  role: string;
  ts: number;
  online: boolean;
  self: boolean;
}
interface ClusterStatus {
  self: string;
  config: { enabled: boolean; role: string; label: string };
  master: string | null;
  masterIsSelf: boolean;
  nodes: ClusterNode[];
}

const SWEEP_SECONDS = 4.5; // must match the .animate-radar keyframe duration

type Status = "ready" | "busy" | "offline";
const STATUS_ACCENT: Record<Status, Accent> = { ready: "lime", busy: "amber", offline: "rose" };

const subTitle = "mb-2 font-mono text-[10px] tracking-[0.18em] text-ink-faint";

export default function DeepSpaceScan() {
  const [usage, setUsage] = useState<UsageEntry[]>([]);
  const [cluster, setCluster] = useState<ClusterStatus | null>(null);

  useEffect(() => {
    const loadUsage = async () => {
      try {
        const r = await fetch("/api/usage?days=7");
        if (r.ok) setUsage(((await r.json()) as { entries: UsageEntry[] }).entries ?? []);
      } catch {
        /* ignore */
      }
    };
    const loadCluster = async () => {
      try {
        const r = await fetch("/api/cluster");
        if (r.ok) setCluster((await r.json()) as ClusterStatus);
      } catch {
        /* ignore */
      }
    };
    loadUsage();
    loadCluster();
    const a = setInterval(loadUsage, 30_000);
    const b = setInterval(loadCluster, 10_000);
    return () => {
      clearInterval(a);
      clearInterval(b);
    };
  }, []);

  return (
    <Panel title="Deep Space Scan" delay={0.2} className="xl:col-span-3">
      <div className="grid gap-5 p-5 md:grid-cols-2 xl:grid-cols-4">
        <FleetRadar />
        <AgentLoad usage={usage} />
        <RunHealth usage={usage} />
        <GroupHealth cluster={cluster} />
      </div>
    </Panel>
  );
}

/* ─── 1. Fleet Radar — real agents; the sweep pings each as it passes ─── */
function FleetRadar() {
  const { agents, busy, system, registry } = useMission();

  const blips = useMemo(() => {
    const fleet: { id: string; name: string; status: Status; accent: Accent }[] = [
      {
        id: "claude",
        name: "Claude",
        status: system?.claudeVersion ? (busy.claude ? "busy" : "ready") : "offline",
        accent: "violet",
      },
      ...agents.map((a) => ({
        id: a.id,
        name: a.name,
        status: (a.available ? (busy[a.id] ? "busy" : "ready") : "offline") as Status,
        accent: a.accent,
      })),
      ...registry.llms.map((l) => ({
        id: l.id,
        name: l.name,
        status: (l.hasKey ? (busy[l.id] ? "busy" : "ready") : "offline") as Status,
        accent: l.accent,
      })),
    ];
    const n = Math.max(1, fleet.length);
    return fleet.map((f, i) => {
      // stable position: evenly spread, radius jittered by a hash of the id
      let h = 0;
      for (const ch of f.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
      const a = (i / n) * Math.PI * 2; // 0 = 12 o'clock, clockwise
      const r = 20 + ((h % 100) / 100) * 22; // 20..42
      const x = 50 + r * Math.sin(a);
      const y = 50 - r * Math.cos(a);
      const deg = ((a * 180) / Math.PI) % 360;
      return { ...f, x, y, delay: (deg / 360) * SWEEP_SECONDS };
    });
  }, [agents, busy, system, registry]);

  const online = blips.filter((b) => b.status !== "offline").length;

  return (
    <div className="flex flex-col">
      <p className={subTitle}>FLEET RADAR</p>
      <div className="relative mx-auto" style={{ width: 176, height: 176 }}>
        <svg viewBox="0 0 100 100" width={176} height={176}>
          {[46, 34, 22, 10].map((r) => (
            <circle key={r} cx="50" cy="50" r={r} fill="none" stroke="rgba(148,163,255,0.16)" strokeWidth="0.4" />
          ))}
          <line x1="4" y1="50" x2="96" y2="50" stroke="rgba(148,163,255,0.12)" strokeWidth="0.4" />
          <line x1="50" y1="4" x2="50" y2="96" stroke="rgba(148,163,255,0.12)" strokeWidth="0.4" />

          {blips.map((b) => {
            const c = ACCENTS[STATUS_ACCENT[b.status]].base;
            return (
              <g key={b.id}>
                <title>{`${b.name} — ${b.status}`}</title>
                {/* ping ripple, timed to when the beam crosses this blip */}
                <circle cx={b.x} cy={b.y} r="2" fill="none" strokeWidth="0.5" style={{ stroke: c }}>
                  <animate attributeName="r" values="2;7;7" keyTimes="0;0.22;1" dur={`${SWEEP_SECONDS}s`} begin={`${b.delay}s`} repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.75;0;0" keyTimes="0;0.22;1" dur={`${SWEEP_SECONDS}s`} begin={`${b.delay}s`} repeatCount="indefinite" />
                </circle>
                <circle cx={b.x} cy={b.y} r={b.status === "busy" ? 2.4 : 1.9} style={{ fill: c }}>
                  <animate attributeName="opacity" values="0.4;1;0.4" keyTimes="0;0.08;1" dur={`${SWEEP_SECONDS}s`} begin={`${b.delay}s`} repeatCount="indefinite" />
                </circle>
              </g>
            );
          })}
        </svg>
        {/* rotating sweep */}
        <div
          className="animate-radar pointer-events-none absolute inset-[3%] rounded-full"
          style={{
            background: "conic-gradient(from 0deg, rgba(34,211,238,0.34) 0deg, rgba(34,211,238,0.06) 55deg, transparent 72deg)",
            maskImage: "radial-gradient(circle, black 96%, transparent 100%)",
          }}
        />
      </div>
      <p className="mt-2 text-center font-mono text-[10px] tracking-[0.14em] text-ink-faint">
        <span className="text-neon-lime">{online}</span> / {blips.length} RESPONDING
      </p>
    </div>
  );
}

/* ─── 2. Agent Load — bars that grow and re-sort as the leader changes ─── */
function AgentLoad({ usage }: { usage: UsageEntry[] }) {
  const rows = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of usage) m.set(e.agent, (m.get(e.agent) ?? 0) + 1);
    return [...m.entries()]
      .map(([agent, runs]) => ({ agent, runs }))
      .sort((a, b) => b.runs - a.runs)
      .slice(0, 6);
  }, [usage]);
  const max = Math.max(1, ...rows.map((r) => r.runs));
  const palette: Accent[] = ["cyan", "violet", "magenta", "amber", "lime", "rose"];

  return (
    <div className="flex flex-col">
      <p className={subTitle}>AGENT LOAD · 7D</p>
      {rows.length === 0 ? (
        <p className="flex flex-1 items-center justify-center text-center text-[11px] text-ink-faint">No runs yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((r, i) => {
            const c = ACCENTS[palette[i % palette.length]].base;
            return (
              <motion.div key={r.agent} layout transition={{ type: "spring", stiffness: 220, damping: 26 }} className="flex items-center gap-2">
                <span className="w-16 shrink-0 truncate font-mono text-[10px] text-ink-dim">{r.agent}</span>
                <div className="h-3 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                  <motion.div
                    className="h-full rounded-full"
                    style={{ background: c }}
                    initial={{ width: 0 }}
                    animate={{ width: `${(r.runs / max) * 100}%` }}
                    transition={{ duration: 0.9, ease: "easeOut" }}
                  />
                </div>
                <span className="w-6 shrink-0 text-right font-mono text-[10px] text-ink-faint">{r.runs}</span>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─── 3. Run Health — animated success-rate ring ─── */
function RunHealth({ usage }: { usage: UsageEntry[] }) {
  const todayStart = new Date().setHours(0, 0, 0, 0);
  const today = usage.filter((e) => e.ts >= todayStart);
  const total = today.length;
  const ok = today.filter((e) => e.ok).length;
  const errors = total - ok;
  const pct = total ? Math.round((ok / total) * 100) : 100;
  const avgMs = total ? Math.round(today.reduce((n, e) => n + e.ms, 0) / total) : 0;
  const c = pct >= 90 ? ACCENTS.lime.base : pct >= 70 ? ACCENTS.amber.base : ACCENTS.rose.base;

  const R = 30;
  const CIRC = 2 * Math.PI * R;

  return (
    <div className="flex flex-col">
      <p className={subTitle}>RUN HEALTH · TODAY</p>
      <div className="relative mx-auto" style={{ width: 130, height: 130 }}>
        <svg viewBox="0 0 80 80" width={130} height={130}>
          <circle cx="40" cy="40" r={R} fill="none" stroke="rgba(148,163,255,0.12)" strokeWidth="6" />
          <motion.circle
            cx="40"
            cy="40"
            r={R}
            fill="none"
            strokeWidth="6"
            strokeLinecap="round"
            style={{ stroke: c }}
            strokeDasharray={CIRC}
            initial={{ strokeDashoffset: CIRC }}
            animate={{ strokeDashoffset: CIRC * (1 - pct / 100) }}
            transition={{ duration: 1.2, ease: "easeOut" }}
            transform="rotate(-90 40 40)"
          />
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-mono text-xl font-bold" style={{ color: c }}>
            <NumberTicker value={pct} />%
          </span>
          <span className="font-mono text-[9px] tracking-[0.14em] text-ink-faint">SUCCESS</span>
        </div>
      </div>
      <div className="mt-2 flex justify-center gap-4 font-mono text-[10px] text-ink-faint">
        <span><span className="text-ink-dim">{total}</span> runs</span>
        <span style={errors ? { color: ACCENTS.rose.base } : undefined}>{errors} err</span>
        <span><span className="text-ink-dim">{(avgMs / 1000).toFixed(1)}s</span> avg</span>
      </div>
    </div>
  );
}

/* ─── 4. Group Health — the machine group / failover state ─── */
function GroupHealth({ cluster }: { cluster: ClusterStatus | null }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000); // live "seen Xs ago"
    return () => clearInterval(t);
  }, []);

  const seen = (ts: number) => {
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.round(s / 60)}m`;
    return `${Math.round(s / 3600)}h`;
  };

  if (!cluster) {
    return (
      <div className="flex flex-col">
        <p className={subTitle}>GROUP HEALTH</p>
        <p className="flex flex-1 items-center justify-center text-[11px] text-ink-faint">…</p>
      </div>
    );
  }

  if (!cluster.config.enabled) {
    return (
      <div className="flex flex-col">
        <p className={subTitle}>GROUP HEALTH</p>
        <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line px-3 py-4 text-center">
          <span className="relative flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: ACCENTS.cyan.base }} />
            <span className="relative inline-flex h-3 w-3 rounded-full" style={{ background: ACCENTS.cyan.base }} />
          </span>
          <p className="text-xs font-semibold text-ink">Standalone</p>
          <p className="text-[10px] leading-4 text-ink-faint">
            This machine runs everything itself. Enable grouping in Settings → Machine Group to add failover.
          </p>
        </div>
      </div>
    );
  }

  const online = cluster.nodes.filter((n) => n.online).length;
  return (
    <div className="flex flex-col">
      <p className={subTitle}>GROUP HEALTH</p>
      <div className="flex flex-col gap-1.5">
        {cluster.nodes.map((n) => {
          const isMaster = cluster.master === n.host;
          const c = n.online ? ACCENTS.lime.base : ACCENTS.rose.base;
          return (
            <div key={n.host} className="flex items-center gap-2 rounded-lg border border-line bg-white/[0.02] px-2 py-1.5">
              {/* heartbeat */}
              <span className="relative flex h-2.5 w-2.5 shrink-0">
                {n.online && (
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: c }} />
                )}
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: c }} />
              </span>
              <span className="min-w-0 flex-1 truncate text-[11px] text-ink-dim">
                {n.label || n.host}
                {n.self && <span className="ml-1 text-ink-faint">(this)</span>}
              </span>
              {isMaster && (
                <span className="shrink-0 rounded bg-neon-lime/10 px-1.5 py-0.5 font-mono text-[8px] tracking-wide text-neon-lime">MASTER</span>
              )}
              <span className="shrink-0 font-mono text-[9px] uppercase text-ink-faint">{n.role.slice(0, 4)}</span>
              <span className="w-7 shrink-0 text-right font-mono text-[9px] text-ink-faint">{seen(n.ts)}</span>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-center font-mono text-[10px] tracking-[0.14em] text-ink-faint">
        <span className="text-neon-lime">{online}</span> / {cluster.nodes.length} ONLINE ·{" "}
        {cluster.master ? <span className="text-ink-dim">{cluster.master}</span> : <span className="text-neon-rose">no master</span>}
      </p>
    </div>
  );
}
