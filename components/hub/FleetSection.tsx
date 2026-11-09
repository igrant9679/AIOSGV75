"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import Panel from "../ui/Panel";
import StatusOrb from "../ui/StatusOrb";
import { ACCENTS, type Accent } from "@/lib/accents";
import type { SessionSummary, SubscriptionMeter } from "@/lib/sessions";
import { useSort } from "./SortControl";
import { SESSION_SORTS } from "./sorts";
import SharingPanel from "./SharingPanel";
import BridgePanel from "./BridgePanel";
import { AlertsPanel, NetworkPanel } from "./NetworkPanels";
import { ConversationButton, ConversationView } from "./Conversation";
import { useHub, SourcePill, HubError, IndexingNote, ago, fmtTokens, until } from "./common";

interface ClusterNode {
  host: string;
  label: string;
  role: string;
  platform: string;
  ts: number;
  online: boolean;
  self: boolean;
  isMaster: boolean;
}

interface ClusterView {
  self: string;
  config: { enabled: boolean; label: string; role: string };
  master: string | null;
  nodes: ClusterNode[];
}

const TOOLS: SubscriptionMeter["tool"][] = ["claude", "codex", "kimi"];

/**
 * Fleet — machines × subscriptions. This machine's cells are live (read from
 * its own session files); other machines show their cluster heartbeat until
 * session summaries are shared through the vault (roadmap phase 4).
 */
export default function FleetSection() {
  const { hub, error, reload } = useHub();
  const [reading, setReading] = useState<string | null>(null);
  const [cluster, setCluster] = useState<ClusterView | null>(null);
  const [pick, setPick] = useState<{ host: string; tool: SubscriptionMeter["tool"] } | null>(null);
  const [showAll, setShowAll] = useState(false);
  const sessionSort = useSort<SessionSummary>("fleet-sessions", SESSION_SORTS);

  useEffect(() => {
    const load = () =>
      fetch("/api/cluster")
        .then((r) => r.json())
        .then((b: ClusterView) => setCluster(b))
        .catch(() => {});
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  const machines = useMemo(() => {
    const self = hub?.host ?? cluster?.self ?? "this machine";
    const rows: { host: string; label: string; online: boolean; self: boolean; role?: string; seen?: number; master?: boolean }[] = [
      { host: self, label: cluster?.config.enabled ? cluster.config.label : self, online: true, self: true, role: cluster?.config.enabled ? cluster.config.role : undefined, master: cluster?.master === self },
    ];
    for (const n of cluster?.nodes ?? []) {
      if (n.self || n.host === self) continue;
      rows.push({ host: n.host, label: n.label, online: n.online, self: false, role: n.role, seen: n.ts, master: n.isMaster });
    }
    // machines that share sessions but aren't in this machine's node list (yet)
    for (const r of hub?.machines ?? []) {
      if (!rows.some((x) => x.host === r.host)) rows.push({ host: r.host, label: r.label, online: !r.stale, self: false, seen: r.publishedAt });
    }
    return rows.map((r) => {
      const shared = hub?.machines.find((x) => x.host === r.host);
      return { ...r, shares: r.self || Boolean(shared), publishedAt: shared?.publishedAt };
    });
  }, [hub, cluster]);

  const cell = (host: string, tool: SubscriptionMeter["tool"]) => {
    const meters = host === hub?.host ? hub?.subscriptions : hub?.machines.find((x) => x.host === host)?.subscriptions;
    const meter = meters?.find((m) => m.tool === tool);
    const sessions = (hub?.sessions ?? []).filter((s) => s.host === host && s.tool === tool && !s.indexing);
    const open = sessions.filter((s) => s.status !== "ended");
    return { meter, sessions, open };
  };

  const selected = pick ?? (hub ? { host: machines[0].host, tool: "claude" as const } : null);
  const detail = selected ? cell(selected.host, selected.tool) : null;

  return (
    <div className="flex flex-col gap-4">
      <HubError error={error} />
      <IndexingNote hub={hub} />
      <Panel title="Machines × subscriptions">
        <div className="overflow-x-auto p-4">
          <div className="grid min-w-[640px] gap-2" style={{ gridTemplateColumns: "180px repeat(3, minmax(0, 1fr))" }}>
            <span />
            {TOOLS.map((t) => (
              <span key={t} className="flex justify-center">
                <SourcePill source={t} label={hub?.subscriptions.find((m) => m.tool === t)?.label ?? t} />
              </span>
            ))}
            {machines.map((m) => (
              <FleetRow key={m.host} m={m} cell={cell} selected={selected} onPick={setPick} />
            ))}
          </div>
          {!cluster?.config.enabled && (
            <p className="pt-3 text-[11px] text-ink-faint">
              Only this machine is shown. Turn on the machine group in{" "}
              <Link href="/settings" className="underline">
                Settings
              </Link>{" "}
              to see your other machines here.
            </p>
          )}
          {cluster?.config.enabled && machines.some((m) => !m.shares) && (
            <p className="pt-3 text-[11px] text-ink-faint">
              Dashed cells: that machine runs an older Mission Control that doesn't share its sessions yet. Run update.cmd there and it
              appears within 5 minutes.
            </p>
          )}
        </div>
      </Panel>

      {selected && detail && (
        <Panel title={`${machines.find((m) => m.host === selected.host)?.label ?? selected.host} · ${detail.meter?.label ?? selected.tool} · ${detail.sessions.length} sessions`} right={detail.sessions.length > 1 ? sessionSort.control : undefined}>
          <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_260px]">
            <div className="flex flex-col">
              {detail.sessions.length === 0 && (
                <p className="text-[11px] text-ink-faint">
                  {detail.meter?.status === "not_set_up" ? detail.meter.note : "No sessions from this tool on this machine yet."}
                </p>
              )}
              {(showAll ? sessionSort.apply(detail.sessions) : sessionSort.apply(detail.sessions).slice(0, 8)).map((s) => (
                <div key={s.key} className="border-b border-line last:border-b-0">
                <div className="flex items-center gap-2 py-2">
                  <StatusOrb accent={s.status === "running" ? "amber" : s.status === "waiting" ? "rose" : s.status === "idle" ? "cyan" : "lime"} pulsing={s.status === "running"} size={7} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold text-ink">{s.title}</span>
                    <span className="block truncate font-mono text-[10px] text-ink-faint">
                      {s.project} · changed {ago(s.updatedAt)} ago{s.lastOpenedAt ? ` · opened ${ago(s.lastOpenedAt)} ago` : ""} · {s.userTurns} prompts · {fmtTokens(s.tokensIn + s.tokensOut)} tokens
                    </span>
                  </span>
                  <ConversationButton open={reading === s.key} onClick={() => setReading(reading === s.key ? null : s.key)} />
                </div>
                {reading === s.key && <ConversationView sessionKey={s.key} />}
                </div>
              ))}
              {detail.sessions.length > 8 && (
                <button type="button" onClick={() => setShowAll((v) => !v)} className="cursor-pointer pt-2 text-center font-mono text-[10px] text-ink-faint hover:text-ink">
                  {showAll ? "Show fewer" : `Show all ${detail.sessions.length}`}
                </button>
              )}
            </div>
            <div className="flex flex-col gap-2 rounded-xl border border-line p-3">
              <p className="panel-title">Send work here</p>
              <p className="text-[11px] leading-4 text-ink-faint">
                Assigning a task to a specific machine and account arrives with the roles board (roadmap phase 6). Today you can run work on this
                machine from the Board page.
              </p>
              <Link href="/board" className="rounded-lg border border-line px-3 py-1.5 text-center font-mono text-[11px] text-ink-dim transition-colors hover:bg-white/[0.06]">
                Open board →
              </Link>
            </div>
          </div>
        </Panel>
      )}

      <NetworkPanel />
      <SharingPanel onShared={reload} />
      <AlertsPanel />
      <BridgePanel />
    </div>
  );
}

function FleetRow({
  m,
  cell,
  selected,
  onPick,
}: {
  m: { host: string; label: string; online: boolean; self: boolean; role?: string; seen?: number; master?: boolean; shares: boolean; publishedAt?: number };
  cell: (host: string, tool: SubscriptionMeter["tool"]) => { meter?: SubscriptionMeter; sessions: unknown[]; open: unknown[] };
  selected: { host: string; tool: SubscriptionMeter["tool"] } | null;
  onPick: (p: { host: string; tool: SubscriptionMeter["tool"] }) => void;
}) {
  return (
    <>
      <span className="flex min-w-0 items-center gap-2 self-center">
        <StatusOrb accent={m.online ? "lime" : "rose"} size={7} />
        <span className="min-w-0">
          <span className="block truncate text-xs font-semibold text-ink">
            {m.label}
            {m.self ? " (this PC)" : ""}
          </span>
          <span className="block truncate font-mono text-[10px] text-ink-faint">
            {[m.role, m.master ? "master" : "", !m.self && m.seen ? `seen ${ago(m.seen)} ago` : "", !m.self && m.publishedAt ? `shared ${ago(m.publishedAt)} ago` : ""]
              .filter(Boolean)
              .join(" · ") || "standalone"}
          </span>
        </span>
      </span>
      {TOOLS.map((t) => {
        const isSel = selected?.host === m.host && selected?.tool === t;
        if (!m.shares) {
          return (
            <div key={t} className="rounded-xl border border-dashed border-line px-3 py-2 text-center font-mono text-[10px] text-ink-faint">
              {m.online ? "not sharing yet — update Mission Control there" : "offline"}
            </div>
          );
        }
        const { meter, sessions, open } = cell(m.host, t);
        const notSetUp = meter?.status === "not_set_up";
        const accent: Accent = meter?.status === "limited" ? "rose" : meter?.status === "near" ? "amber" : "lime";
        return (
          <button
            key={t}
            type="button"
            onClick={() => onPick({ host: m.host, tool: t })}
            className="cursor-pointer rounded-xl border px-3 py-2 text-left transition-colors hover:bg-white/[0.04]"
            style={{ borderColor: isSel ? "var(--page-accent)" : "var(--color-line)" }}
          >
            {notSetUp ? (
              <span className="font-mono text-[10px] text-ink-faint">not set up</span>
            ) : (
              <>
                <span className="flex justify-between font-mono text-[10px]">
                  <span className="text-ink">{open.length > 0 ? `${open.length} open` : "idle"}</span>
                  <span className="text-ink-faint">{sessions.length} total</span>
                </span>
                {meter?.usedPercent !== undefined ? (
                  <>
                    <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full" style={{ background: "var(--color-line)" }}>
                      <span className="block h-full rounded-full" style={{ width: `${meter.usedPercent}%`, background: ACCENTS[accent].base }} />
                    </span>
                    <span className="block pt-1 font-mono text-[10px] text-ink-faint">
                      {meter.usedPercent}% {meter.windowLabel}
                      {meter.resetsAt ? ` · ${until(meter.resetsAt)}` : ""}
                    </span>
                  </>
                ) : (
                  <span className="block pt-1 font-mono text-[10px] text-ink-faint">{fmtTokens(meter?.tokens5h ?? 0)} tokens · 5h</span>
                )}
              </>
            )}
          </button>
        );
      })}
    </>
  );
}
