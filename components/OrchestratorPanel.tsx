"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ACCENTS, type Accent } from "@/lib/accents";
import type { Orchestration, OrchStep } from "@/lib/orchestrator";
import Panel from "./ui/Panel";
import StatusOrb from "./ui/StatusOrb";
import Markdown from "./Markdown";
import MicButton from "./MicButton";
import { useMission } from "./store";

const STEP_ACCENT: Record<OrchStep["status"], Accent> = {
  pending: "cyan",
  running: "amber",
  review: "violet",
  rework: "magenta",
  done: "lime",
  error: "rose",
};

const ORCH_LABEL: Record<Orchestration["status"], string> = {
  planning: "planning…",
  running: "dispatching & reviewing…",
  assembling: "assembling…",
  done: "done",
  error: "failed",
};

export default function OrchestratorPanel({ delay = 0 }: { delay?: number }) {
  const { addEvent } = useMission();
  const [goal, setGoal] = useState("");
  const [items, setItems] = useState<Orchestration[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState("");

  const anyActive = items.some((o) => o.status !== "done" && o.status !== "error");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/orchestrations");
      if (res.ok) setItems(((await res.json()) as { orchestrations: Orchestration[] }).orchestrations ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, anyActive ? 4_000 : 20_000);
    return () => clearInterval(t);
  }, [load, anyActive]);

  const launch = async () => {
    const g = goal.trim();
    if (!g) return;
    setErr("");
    const res = await fetch("/api/orchestrations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal: g }),
    });
    const json = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok || !json.ok) {
      setErr(json.error ?? "launch failed");
      return;
    }
    setGoal("");
    addEvent("ORCHESTRATOR", `Goal accepted: ${g.slice(0, 60)}`, "violet");
    load();
  };

  return (
    <Panel
      title="🤖 Orchestrator"
      right={<span className="font-mono text-[10px] text-ink-faint">plan → dispatch (Auto) → review → rework → assemble</span>}
      delay={delay}
    >
      <div className="flex flex-col gap-3 p-4">
        <p className="text-[11px] leading-5 text-ink-faint">
          Hand over a goal. Claude decomposes it, <span className="text-neon-cyan">Auto</span> routes each subtask to the
          cheapest capable model, Claude reviews every output and sends weak work back (max 2 reworks), then assembles the
          final deliverable — archived to the vault, tracked on this board, and pinged to your Telegram.
        </p>
        {err && <p className="rounded-lg border border-neon-rose/30 bg-neon-rose/10 px-3 py-1.5 font-mono text-[11px] text-neon-rose">{err}</p>}
        <div className="flex items-start gap-2">
          <textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            rows={2}
            placeholder="e.g. Research the top 3 CRM options for a small nonprofit, compare pricing and integrations, and draft a recommendation memo…"
            className="min-h-16 w-full resize-none rounded-lg border border-line bg-panel-2 px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-line-bright"
          />
          <div className="flex flex-col gap-2">
            <MicButton onFinal={(t) => setGoal((g) => (g ? `${g} ${t}` : t))} />
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={launch}
              disabled={!goal.trim()}
              className="cursor-pointer rounded-lg bg-gradient-to-br from-violet-700 to-neon-violet px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-35"
            >
              Launch
            </motion.button>
          </div>
        </div>

        {items.slice(0, 6).map((o) => {
          const isOpen = open === o.id;
          const active = o.status !== "done" && o.status !== "error";
          return (
            <div key={o.id} className="rounded-xl border border-line bg-white/[0.02]">
              <button
                onClick={() => setOpen(isOpen ? null : o.id)}
                className="flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left"
              >
                <StatusOrb accent={o.status === "done" ? "lime" : o.status === "error" ? "rose" : "amber"} pulsing={active} size={8} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink">{o.goal.slice(0, 90)}</span>
                  <span className="font-mono text-[10px] text-ink-faint">
                    {ORCH_LABEL[o.status]}
                    {o.steps.length > 0 && ` · ${o.steps.filter((s) => s.status === "done").length}/${o.steps.length} subtasks`}
                    {o.plannerNote && " · ⚠ fallback plan"}
                  </span>
                </span>
                <span className="font-mono text-[10px] text-ink-faint">{isOpen ? "▾" : "▸"}</span>
              </button>
              {isOpen && (
                <div className="flex flex-col gap-2 border-t border-line px-3 py-3">
                  {o.steps.map((s) => (
                    <div key={s.id} className="flex items-center gap-2">
                      <StatusOrb accent={STEP_ACCENT[s.status]} pulsing={s.status === "running" || s.status === "rework"} size={7} />
                      <span className="min-w-0 flex-1 truncate text-xs text-ink">{s.title}</span>
                      <span className="shrink-0 font-mono text-[10px] text-ink-faint">
                        {s.status}
                        {s.routedTo ? ` · ${s.routedTo}` : ""}
                        {s.attempts > 1 ? ` · attempt ${s.attempts}` : ""}
                      </span>
                    </div>
                  ))}
                  {o.error && <p className="font-mono text-[11px] text-neon-rose">{o.error}</p>}
                  {o.final && (
                    <div className="max-h-80 overflow-y-auto rounded-lg border border-line bg-white/[0.015] p-3">
                      <Markdown>{o.final}</Markdown>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
