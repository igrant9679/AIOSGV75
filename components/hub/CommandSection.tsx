"use client";

import Link from "next/link";
import { useMemo } from "react";
import Panel from "../ui/Panel";
import GlowTile from "../ui/GlowTile";
import EmptyState from "../ui/EmptyState";
import { ACCENTS } from "@/lib/accents";
import { useHub, SourcePill, ViaTag, StatusDot, MeterRow, HubError, IndexingNote, ago } from "./common";
import type { ActivityItem } from "@/lib/activity";
import { useSort } from "./SortControl";
import HealthPanel from "./HealthPanel";
import { ACTIVITY_SORTS } from "./sorts";

/**
 * Command — the status-first home of the second brain: what's running, what's
 * blocked on you, what finished today, and how much each subscription has left.
 */
export default function CommandSection() {
  const { hub, error } = useHub();
  const liveSort = useSort<ActivityItem>("command-live", ACTIVITY_SORTS);

  const view = useMemo(() => {
    if (!hub) return null;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const sod = startOfDay.getTime();
    const live = hub.items.filter((i) => i.status === "running" || i.status === "waiting" || i.status === "idle");
    const waitingSessions = hub.items.filter((i) => i.status === "waiting");
    const doneToday = hub.items.filter((i) => i.status === "done" && i.ts >= sod && i.source !== "memory").length;
    const memToday = hub.memory.filter((m) => m.ts >= sod).length;
    const needs = [
      ...waitingSessions.map((i) => ({ key: i.id, label: `${i.agent} is waiting for you`, detail: i.title, ts: i.ts, href: "/timeline", accent: "amber" as const })),
      ...hub.attention.map((a) => ({
        key: `${a.kind}:${a.id}`,
        label: a.label,
        detail: a.detail,
        ts: a.ts,
        href: a.kind === "schedule_failed" ? "/schedule" : a.kind === "approval" ? "/" : "/missions",
        accent: a.kind === "approval" || a.kind === "mission_stalled" ? ("amber" as const) : ("rose" as const),
      })),
    ].sort((a, b) => b.ts - a.ts);
    return { live, needs, doneToday, memToday, running: live.filter((i) => i.status === "running").length };
  }, [hub]);

  return (
    <div className="flex flex-col gap-4">
      <HubError error={error} />
      <IndexingNote hub={hub} />
      <HealthPanel />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <GlowTile accent="amber" label="Running now" value={view ? view.running : "—"} />
        <GlowTile accent="rose" label="Waiting on you" value={view ? view.needs.length : "—"} />
        <GlowTile accent="lime" label="Done today" value={view ? view.doneToday : "—"} />
        <GlowTile accent="violet" label="Memories saved today" value={view ? view.memToday : "—"} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel title="Needs you" delay={0.05}>
          <div className="flex flex-col gap-2 p-4">
            {view && view.needs.length === 0 && <EmptyState accent="lime" title="Nothing blocked" hint="No approvals, failures or sessions waiting on you." compact />}
            {view?.needs.slice(0, 8).map((n) => (
              <Link
                key={n.key}
                href={n.href}
                className="block rounded-xl border border-line px-3 py-2 transition-colors hover:border-line-bright"
                style={{ borderLeft: `3px solid ${ACCENTS[n.accent].base}` }}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-semibold text-ink">{n.label}</span>
                  <span className="shrink-0 font-mono text-[10px] text-ink-faint">{ago(n.ts)}</span>
                </span>
                <span className="block truncate pt-0.5 text-[11px] text-ink-faint">{n.detail}</span>
              </Link>
            ))}
          </div>
        </Panel>

        <Panel
          title="Live now"
          delay={0.1}
          right={
            <span className="flex items-center gap-2">
              {(view?.live.length ?? 0) > 1 && liveSort.control}
              <Link href="/timeline" className="font-mono text-[10px] text-ink-faint hover:text-ink">
                Timeline →
              </Link>
            </span>
          }
        >
          <div className="flex flex-col p-4">
            {view && view.live.length === 0 && <EmptyState accent="cyan" title="All quiet" hint="No sessions or missions are open right now." compact />}
            {liveSort.apply(view?.live ?? []).slice(0, 10).map((i) => (
              <div key={i.id} className="flex items-center gap-2 border-b border-line py-2 last:border-b-0">
                <StatusDot status={i.status} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold text-ink">{i.title}</span>
                  <span className="block truncate font-mono text-[10px] text-ink-faint">
                    {i.project ? `${i.project} · ` : ""}
                    {i.host}
                  </span>
                </span>
                <ViaTag via={i.via} />
                <SourcePill source={i.source} />
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Subscriptions" delay={0.15}>
          <div className="flex flex-col gap-2 p-4">
            {hub?.subscriptions.map((m) => <MeterRow key={m.id} m={m} />)}
            <p className="px-1 pt-1 text-[10px] leading-4 text-ink-faint">
              Workers run on your Claude, ChatGPT and Kimi subscriptions through their own CLIs — no API keys. Hover a row for where its numbers come from.
            </p>
          </div>
        </Panel>
      </div>

      <Panel title="Latest across everything" delay={0.2}>
        <div className="flex flex-col p-4">
          {hub?.items.slice(0, 8).map((i) => (
            <div key={i.id} className="flex items-center gap-3 border-b border-line py-2 last:border-b-0">
              <span className="w-10 shrink-0 font-mono text-[10px] text-ink-faint">{ago(i.ts)}</span>
              <SourcePill source={i.source} />
              <span className="min-w-0 flex-1 truncate text-xs text-ink">{i.title}</span>
              <StatusDot status={i.status} />
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
