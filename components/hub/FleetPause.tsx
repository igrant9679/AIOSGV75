"use client";

import { useCallback, useEffect, useState } from "react";
import Panel from "../ui/Panel";
import { ACCENTS } from "@/lib/accents";
import { ago } from "./common";

interface PauseState {
  paused: boolean;
  by?: string;
  at?: number;
  until?: number;
  reason?: string;
  error?: string;
}

const HELD = "schedules, watchers, approved missions and project runs are held on every machine";

function usePause(intervalMs = 20_000) {
  const [state, setState] = useState<PauseState | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      setState((await (await fetch("/api/hub/pause")).json()) as PauseState);
    } catch {
      /* keep the last state */
    }
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, intervalMs);
    return () => clearInterval(t);
  }, [load, intervalMs]);
  const set = async (body: { paused: boolean; hours?: number; reason?: string }) => {
    setBusy(true);
    try {
      const r = await fetch("/api/hub/pause", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const b = (await r.json()) as PauseState;
      setState(r.ok ? b : (s) => ({ ...(s ?? { paused: false }), error: b.error }));
    } finally {
      setBusy(false);
    }
  };
  return { state, busy, set };
}

const when = (ts: number) => new Date(ts).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });

/** On every page while the fleet is paused, with Resume. */
export function FleetPauseBar() {
  const { state, busy, set } = usePause();
  if (!state?.paused) return null;
  return (
    <div role="status" className="panel flex flex-wrap items-center gap-3 px-4 py-2.5" style={{ borderColor: ACCENTS.amber.border }}>
      <span className="text-xs font-semibold" style={{ color: ACCENTS.amber.base }}>
        Fleet paused
      </span>
      <span className="min-w-0 flex-1 font-mono text-[11px] text-ink-dim">
        by {state.by ?? "?"}
        {state.at ? ` ${ago(state.at)} ago` : ""} · {state.until ? `ends by itself ${when(state.until)}` : "until resumed"} · {HELD}. What runs now finishes; what you start yourself still runs.
        {state.reason ? ` Reason: ${state.reason}` : ""}
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={() => set({ paused: false })}
        className="cursor-pointer rounded-lg px-3 py-1.5 text-xs font-bold text-black disabled:opacity-50"
        style={{ background: ACCENTS.lime.base }}
      >
        {busy ? "Resuming…" : "Resume"}
      </button>
    </div>
  );
}

/** Command → Fleet pause: hold every machine's autonomous work for a while, or until resumed. */
export function FleetPausePanel() {
  const { state, busy, set } = usePause(30_000);
  const [reason, setReason] = useState("");
  if (!state) return null;
  const btn = "cursor-pointer rounded-md border px-2.5 py-1 font-mono text-[11px] transition-colors hover:bg-white/[0.06] disabled:opacity-50";
  return (
    <Panel title="Fleet pause" delay={0.02}>
      <div className="flex flex-col gap-2 p-4">
        {state.paused ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-ink">
              <span className="font-semibold" style={{ color: ACCENTS.amber.base }}>
                Paused
              </span>{" "}
              by {state.by ?? "?"} {state.at ? `${ago(state.at)} ago` : ""}, {state.until ? `until ${when(state.until)}` : "until resumed"}.
            </span>
            <button type="button" disabled={busy} onClick={() => set({ paused: false })} className={btn} style={{ borderColor: ACCENTS.lime.border, color: ACCENTS.lime.base }}>
              Resume now
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-ink-dim">Hold every machine&apos;s autonomous work:</span>
            {(
              [
                [1, "1 hour"],
                [4, "4 hours"],
                [0, "until I resume"],
              ] as const
            ).map(([h, label]) => (
              <button
                key={h}
                type="button"
                disabled={busy}
                onClick={() => set({ paused: true, hours: h || undefined, reason: reason || undefined })}
                className={btn}
                style={{ borderColor: ACCENTS.amber.border, color: ACCENTS.amber.base }}
              >
                Pause {label}
              </button>
            ))}
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="reason (optional)"
              maxLength={200}
              className="min-w-0 flex-1 rounded-md border border-line bg-transparent px-2 py-1 font-mono text-[11px] text-ink placeholder:text-ink-faint"
            />
          </div>
        )}
        <p className="text-[10px] leading-4 text-ink-faint">
          While paused, {HELD}, and queued run work waits. What is running finishes; chats, replies and missions you start yourself still run; updates
          (Fleet → Versions) still run. Every machine sees it within a minute or two, and any of them can resume it.
        </p>
        {state.error && (
          <p className="text-[11px]" style={{ color: ACCENTS.rose.base }}>
            {state.error}
          </p>
        )}
      </div>
    </Panel>
  );
}
