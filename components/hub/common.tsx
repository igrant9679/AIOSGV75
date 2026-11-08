"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ACCENTS, type Accent } from "@/lib/accents";
import type { HubSnapshot, ActivitySource, ActivityStatus } from "@/lib/activity";
import type { SubscriptionMeter } from "@/lib/sessions";
import { LAUNCH_SURFACE_META, type LaunchSurface } from "@/lib/launchSurface";
import StatusOrb from "../ui/StatusOrb";

/** Shared client plumbing for the second-brain pages. */

export function useHub(intervalMs = 15_000) {
  const [hub, setHub] = useState<HubSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/hub");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setHub(body as HubSnapshot);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, intervalMs);
    return () => clearInterval(t);
  }, [load, intervalMs]);
  return { hub, error, reload: load };
}

export const SOURCE_META: Record<ActivitySource | "kimi", { label: string; accent: Accent }> = {
  claude: { label: "Claude", accent: "violet" },
  codex: { label: "Codex", accent: "lime" },
  kimi: { label: "Kimi", accent: "rose" },
  chat: { label: "Chat", accent: "cyan" },
  mission: { label: "Mission", accent: "cyan" },
  orchestration: { label: "Orchestrator", accent: "amber" },
  memory: { label: "Memory", accent: "magenta" },
};

export const STATUS_META: Record<ActivityStatus, { label: string; accent: Accent; pulsing?: boolean }> = {
  running: { label: "Running", accent: "amber", pulsing: true },
  waiting: { label: "Waiting on you", accent: "rose", pulsing: true },
  idle: { label: "Open", accent: "cyan" },
  done: { label: "Done", accent: "lime" },
  error: { label: "Failed", accent: "rose" },
};

export function SourcePill({ source, label }: { source: ActivitySource | "kimi"; label?: string }) {
  const m = SOURCE_META[source];
  const c = ACCENTS[m.accent];
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-wide"
      style={{ background: c.soft, color: c.base }}
    >
      {label ?? m.label}
    </span>
  );
}

/** Where a session was started — Desktop app, Terminal, IDE, Background. */
export function ViaTag({ via }: { via?: LaunchSurface }) {
  if (!via) return null;
  const m = LAUNCH_SURFACE_META[via];
  return (
    <span
      title={m.hint}
      className="inline-flex shrink-0 items-center rounded-md border border-line px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-ink-dim"
    >
      {m.label}
    </span>
  );
}

export function StatusDot({ status }: { status: ActivityStatus }) {
  const m = STATUS_META[status];
  return (
    <span title={m.label} className="inline-flex shrink-0">
      <StatusOrb accent={m.accent} pulsing={m.pulsing} size={7} />
    </span>
  );
}

export function ago(ts: number): string {
  if (!ts) return "—";
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function until(ts?: number): string {
  if (!ts) return "";
  const s = Math.max(0, Math.floor((ts - Date.now()) / 1000));
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
}

export function fmtTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

export function clockTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** "today 14:02", "yesterday 09:15", "Nov 4, 14:02", "Nov 4 2025" — a date you can read at a glance. */
export function stamp(ts?: number): string {
  if (!ts) return "—";
  const d = new Date(ts);
  const now = new Date();
  const time = clockTime(ts);
  if (d.toDateString() === now.toDateString()) return `today ${time}`;
  if (d.toDateString() === new Date(Date.now() - 86_400_000).toDateString()) return `yesterday ${time}`;
  const md = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return d.getFullYear() === now.getFullYear() ? `${md}, ${time}` : `${md} ${d.getFullYear()}`;
}

/** Full timestamps for a hover tooltip. */
export function timesTitle(t: { startedAt?: number; updatedAt?: number; lastOpenedAt?: number }): string {
  const full = (ts?: number) => (ts ? new Date(ts).toLocaleString() : "—");
  const lines = [`Created: ${full(t.startedAt)}`, `Last changed: ${full(t.updatedAt)}`];
  if (t.lastOpenedAt) lines.push(`Last opened: ${full(t.lastOpenedAt)}`);
  return lines.join("\n");
}

/** "created Nov 4, 10:12 · changed 2h ago · opened 5m ago" */
export function timesLine(t: { startedAt?: number; updatedAt?: number; lastOpenedAt?: number }): string {
  const parts = [`created ${stamp(t.startedAt)}`, `changed ${t.updatedAt ? `${ago(t.updatedAt)} ago` : "—"}`];
  if (t.lastOpenedAt) parts.push(`opened ${ago(t.lastOpenedAt)} ago`);
  return parts.join(" · ");
}

export function dayLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const yest = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yest.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/** One subscription's usage-limit bar (or a token count when no limit data exists). */
export function MeterRow({ m }: { m: SubscriptionMeter }) {
  const accent: Accent = m.status === "limited" ? "rose" : m.status === "near" ? "amber" : m.status === "not_set_up" ? "cyan" : "lime";
  const c = ACCENTS[accent];
  const src = SOURCE_META[m.tool];
  return (
    <div className="rounded-xl border border-line px-3 py-2.5" title={m.note}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <SourcePill source={m.tool} label={src.label} />
          <span className="truncate text-xs font-semibold text-ink">{m.label}</span>
        </span>
        <span className="shrink-0 font-mono text-[10px] text-ink-faint">
          {m.plan ? m.plan : ""}
        </span>
      </div>
      {m.status === "not_set_up" ? (
        <p className="pt-1.5 text-[11px] text-ink-faint">{m.note}</p>
      ) : m.usedPercent !== undefined ? (
        <>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]" style={{ background: "var(--color-line)" }}>
            <div className="h-full rounded-full" style={{ width: `${Math.min(100, m.usedPercent)}%`, background: c.base }} />
          </div>
          <p className="flex justify-between pt-1 font-mono text-[10px] text-ink-faint">
            <span style={{ color: c.base }}>
              {m.usedPercent}% used{m.windowLabel ? ` · ${m.windowLabel}` : ""}
            </span>
            <span>{m.resetsAt ? `resets in ${until(m.resetsAt)}` : ""}</span>
          </p>
        </>
      ) : (
        <p className="flex justify-between pt-1.5 font-mono text-[10px] text-ink-faint">
          <span>
            {fmtTokens(m.tokens5h)} tokens · 5h &nbsp;·&nbsp; {fmtTokens(m.tokens7d)} · 7d
          </span>
          <span>limit not reported</span>
        </p>
      )}
    </div>
  );
}

export function HubError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p className="rounded-xl border border-line px-4 py-2 font-mono text-[11px]" style={{ color: ACCENTS.rose.base }}>
      Couldn&apos;t load hub data: {error}
    </p>
  );
}

export function IndexingNote({ hub }: { hub: HubSnapshot | null }) {
  if (!hub || hub.indexing.done >= hub.indexing.total) return null;
  return (
    <p className="font-mono text-[10px] tracking-wide text-ink-faint">
      Indexing session history · {hub.indexing.done} of {hub.indexing.total} files read — older sessions fill in on each refresh
    </p>
  );
}

export function Chip({ active, onClick, title, children }: { active?: boolean; onClick?: () => void; title?: string; children: ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      onClick={onClick}
      className="cursor-pointer rounded-md border px-2 py-1 font-mono text-[10px] tracking-wide transition-colors hover:bg-white/[0.06]"
      style={{
        borderColor: active ? "var(--page-accent, var(--ac-cyan))" : "var(--color-line)",
        color: active ? "var(--page-accent, var(--ac-cyan))" : "var(--color-ink-dim)",
      }}
    >
      {children}
    </button>
  );
}
