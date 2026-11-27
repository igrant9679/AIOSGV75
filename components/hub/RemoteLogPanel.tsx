"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Panel from "../ui/Panel";
import { ACCENTS, type Accent } from "@/lib/accents";
import type { CheckedAction } from "@/lib/remoteCheck";
import { ago } from "./common";

interface LogView {
  self: string;
  machines: { host: string; label: string; publishedAt: number; coversFrom: number; entries: number }[];
  rows: CheckedAction[];
  unmatched: number;
  error?: string;
}

type Filter = "all" | "refused" | "flagged";

const KIND: Record<string, string> = {
  reply: "reply",
  new: "new session",
  stop: "stop",
  import: "move in",
  export: "move out",
  check: "check",
  update: "update",
  setup: "setup change",
  permission: "permission",
  skill: "skill copy",
  thread: "read",
};

/**
 * Fleet → Remote actions: what each machine was asked to do by another one, and whether it did it.
 * Requests travel through a vault folder anything syncing the vault could write to, so a request
 * the named sender has no record of sending is flagged (lib/remoteLog.ts crossCheck).
 */
export default function RemoteLogPanel() {
  const [view, setView] = useState<LogView | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [more, setMore] = useState(false);

  const load = useCallback(() => {
    fetch("/api/hub/actions")
      .then((r) => r.json())
      .then((b: LogView) => setView(b))
      .catch(() => {});
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  const rows = useMemo(() => {
    const all = view?.rows ?? [];
    if (filter === "refused") return all.filter((r) => r.outcome === "refused" || r.outcome === "failed" || r.status === "error");
    if (filter === "flagged") return all.filter((r) => r.unmatched);
    return all;
  }, [view, filter]);
  const shown = more ? rows : rows.slice(0, 12);
  const label = (host: string, fallback?: string) => view?.machines.find((m) => m.host.toLowerCase() === host.toLowerCase())?.label ?? fallback ?? host;

  return (
    <Panel
      title="Remote actions"
      right={
        <span className="flex gap-1">
          {(["all", "refused", "flagged"] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className="cursor-pointer rounded-md border border-line px-2 py-0.5 font-mono text-[10px] transition-colors hover:bg-white/[0.06]"
              style={filter === f ? { color: "var(--color-ink)", background: "var(--color-line)" } : { color: "var(--color-ink-faint)" }}
            >
              {f === "flagged" && view?.unmatched ? `flagged ${view.unmatched}` : f}
            </button>
          ))}
        </span>
      }
    >
      <div className="flex flex-col gap-2 p-4">
        <p className="text-[11px] leading-4 text-ink-faint">
          Every request one machine made of another: replies, new sessions, stops, moves, permission answers, updates and setup changes. Both
          ends record it. A request that names a machine with no record of sending it is flagged. Requests travel through the vault, so
          anything that can write to the vault could forge one. Opening or reading a conversation isn&apos;t recorded.
        </p>
        {view && view.unmatched > 0 && (
          <p className="rounded-lg border px-3 py-2 text-[11px] leading-4" style={{ borderColor: ACCENTS.rose.border, color: ACCENTS.rose.base }}>
            {view.unmatched} request{view.unmatched === 1 ? "" : "s"} carried out here or on another machine came from a machine whose own log doesn&apos;t
            show sending {view.unmatched === 1 ? "it" : "them"}. If you didn&apos;t do this, check what can write to the vault&apos;s Cluster/requests folder.
          </p>
        )}
        {view?.error && <p className="font-mono text-[11px]" style={{ color: ACCENTS.rose.base }}>{view.error}</p>}
        {view && rows.length === 0 && (
          <p className="text-[11px] text-ink-faint">{filter === "all" ? "Nothing recorded yet. Machines start recording once they run this version." : `Nothing ${filter}.`}</p>
        )}
        <div className="flex flex-col">
          {shown.map((r) => (
            <Row key={`${r.id}|${r.host}`} r={r} from={label(r.from, r.fromLabel)} to={label(r.host, r.hostLabel)} />
          ))}
        </div>
        {rows.length > 12 && (
          <button type="button" onClick={() => setMore((v) => !v)} className="cursor-pointer text-center font-mono text-[10px] text-ink-faint hover:text-ink">
            {more ? "Show fewer" : `Show all ${rows.length}`}
          </button>
        )}
        {view && (
          <p className="font-mono text-[10px] leading-4 text-ink-faint">
            Logs from:{" "}
            {view.machines.map((m, i) => (
              <span key={m.host}>
                {i > 0 ? " · " : ""}
                {m.label}
                {m.host === view.self ? " (live)" : ` (shared ${ago(m.publishedAt)} ago)`}
              </span>
            ))}
            . A machine on an older version keeps no log, so its requests can&apos;t be checked.
          </p>
        )}
      </div>
    </Panel>
  );
}

function Row({ r, from, to }: { r: CheckedAction; from: string; to: string }) {
  const bad = r.outcome === "refused" || r.outcome === "failed" || r.status === "error";
  const accent: Accent = r.unmatched ? "rose" : bad ? "amber" : r.status === "running" || r.status === "queued" || r.status === "sent" ? "cyan" : "lime";
  const state = r.unmatched
    ? "not sent by that machine"
    : r.outcome === "refused"
      ? "refused"
      : r.outcome === "failed"
        ? "failed"
        : r.status === "error"
          ? "ended with an error"
          : r.status === "expired"
            ? "expired"
            : r.status && ["queued", "sent", "running"].includes(r.status)
              ? r.status
              : r.dir === "out" && r.outcome === "sent"
                ? "sent"
                : "done";
  return (
    <div className="flex items-start gap-2 border-b border-line py-1.5 last:border-b-0" title={[r.reason, r.unmatched].filter(Boolean).join(" ") || undefined}>
      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: ACCENTS[accent].base }} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11px] text-ink">
          <span className="font-mono text-[10px] text-ink-faint">{KIND[r.kind] ?? r.kind}</span> {r.what || "—"}
        </span>
        <span className="block truncate font-mono text-[10px] text-ink-faint">
          {from} → {to} · {r.via ?? "?"}
          {r.access === "edit" ? " · may edit files" : ""} · {ago(r.at)} ago
          {r.reason ? ` · ${r.reason}` : ""}
        </span>
      </span>
      <span className="shrink-0 font-mono text-[10px]" style={{ color: ACCENTS[accent].base }}>
        {state}
      </span>
    </div>
  );
}
