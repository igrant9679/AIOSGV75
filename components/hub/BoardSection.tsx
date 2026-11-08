"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import Panel from "../ui/Panel";
import EmptyState from "../ui/EmptyState";
import Markdown from "../Markdown";
import { ACCENTS, type Accent } from "@/lib/accents";
import type { OrchStep, Orchestration } from "@/lib/orchestrator";
import { useMission } from "../store";
import { useHub, HubError, Chip, ago } from "./common";

type Lane = "planned" | "running" | "review" | "needs" | "done";

const LANES: { id: Lane; label: string; accent: Accent }[] = [
  { id: "planned", label: "Planned", accent: "cyan" },
  { id: "running", label: "Running", accent: "amber" },
  { id: "review", label: "In review", accent: "violet" },
  { id: "needs", label: "Needs you", accent: "rose" },
  { id: "done", label: "Done", accent: "lime" },
];

function laneOf(s: OrchStep): Lane {
  if (s.status === "pending") return "planned";
  if (s.status === "running") return "running";
  if (s.status === "review" || s.status === "rework") return "review";
  if (s.status === "error") return "needs";
  return "done";
}

interface Card {
  key: string;
  title: string;
  goal: string;
  orchId: string;
  role: string;
  roleAccent: Accent;
  meta: string;
}

/**
 * Board — the mission board view of the Orchestrator: give the fleet a goal,
 * the manager (Claude) splits it into subtasks, workers run them, the reviewer
 * (Claude) passes or sends work back. Uses the existing /api/orchestrations
 * engine; Hermes-style named roles and per-account lanes are roadmap phase 5.
 */
export default function BoardSection() {
  const { hub, error, reload } = useHub(5_000);
  const { registry } = useMission();
  const [goal, setGoal] = useState("");
  const [workers, setWorkers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const workerChoices = useMemo(
    () => [{ id: "claude", name: "Claude" }, ...registry.commandAgents.map((a) => ({ id: a.id, name: a.name }))],
    [registry],
  );

  const orchs: Orchestration[] = hub?.orchestrations ?? [];
  const lanes = useMemo(() => {
    const out: Record<Lane, Card[]> = { planned: [], running: [], review: [], needs: [], done: [] };
    for (const o of orchs.slice(0, 12)) {
      if (o.status === "planning") {
        out.planned.push({ key: `${o.id}-plan`, title: "Splitting the goal into subtasks…", goal: o.goal, orchId: o.id, role: "Manager", roleAccent: "violet", meta: ago(o.createdAt) });
      }
      if (o.status === "assembling") {
        out.review.push({ key: `${o.id}-asm`, title: "Assembling the final deliverable", goal: o.goal, orchId: o.id, role: "Manager", roleAccent: "violet", meta: "all subtasks passed" });
      }
      if (o.status === "error" && o.steps.length === 0) {
        out.needs.push({ key: `${o.id}-err`, title: o.error ?? "Orchestration failed", goal: o.goal, orchId: o.id, role: "Manager", roleAccent: "violet", meta: ago(o.createdAt) });
      }
      for (const s of o.steps) {
        const lane = laneOf(s);
        const reviewing = lane === "review";
        out[lane].push({
          key: `${o.id}-${s.id}`,
          title: s.title,
          goal: o.goal,
          orchId: o.id,
          role: reviewing ? "Reviewer" : "Worker",
          roleAccent: reviewing ? "violet" : "lime",
          meta: [s.routedTo, s.attempts > 1 ? `try ${s.attempts}` : "", s.feedback && lane !== "done" ? "has feedback" : ""].filter(Boolean).join(" · ") || "—",
        });
      }
    }
    return out;
  }, [orchs]);

  const launch = async () => {
    const g = goal.trim();
    if (!g) {
      setMsg({ text: "Enter a goal first.", ok: false });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/orchestrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: g, workers }),
      });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setGoal("");
      setMsg({ text: "Goal handed to the manager — cards appear as it plans.", ok: true });
      reload();
    } catch (e) {
      setMsg({ text: (e as Error).message, ok: false });
    } finally {
      setBusy(false);
    }
  };

  const openOrch = orchs.find((o) => o.id === open);

  return (
    <div className="flex flex-col gap-4">
      <HubError error={error} />
      <div className="panel flex flex-col gap-3 p-4">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            launch();
          }}
        >
          <input
            value={goal}
            onChange={(e) => {
              setGoal(e.target.value);
              if (msg && !msg.ok) setMsg(null);
            }}
            placeholder="Give the fleet a goal — e.g. Draft a launch checklist for the Sessions page"
            aria-label="Goal for the fleet"
            className="min-w-0 flex-1 rounded-lg border border-line bg-transparent px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-line-bright"
          />
          <button
            type="submit"
            disabled={busy}
            className="cursor-pointer rounded-lg px-4 py-2 font-mono text-[11px] font-bold tracking-wide"
            style={{ background: ACCENTS.violet.soft, color: ACCENTS.violet.base, border: `1px solid ${ACCENTS.violet.border}` }}
          >
            {busy ? "Planning…" : "Plan it"}
          </button>
        </form>
        {msg && (
          <p className="text-[11px]" style={{ color: msg.ok ? ACCENTS.lime.base : ACCENTS.rose.base }}>
            {msg.text}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="panel-title pr-1">Roles</span>
          <RolePill accent="violet" text="Manager · Claude" />
          <RolePill accent="lime" text={`Workers · ${workers.length ? workers.map((w) => workerChoices.find((c) => c.id === w)?.name ?? w).join(", ") : "Auto router"}`} />
          <RolePill accent="violet" text="Reviewer · Claude" />
          <span className="panel-title pl-3 pr-1">Pin workers</span>
          <Chip active={workers.length === 0} onClick={() => setWorkers([])}>Auto</Chip>
          {workerChoices.map((w) => (
            <Chip
              key={w.id}
              active={workers.includes(w.id)}
              onClick={() => setWorkers((cur) => (cur.includes(w.id) ? cur.filter((x) => x !== w.id) : [...cur, w.id].slice(0, 4)))}
            >
              {w.name}
            </Chip>
          ))}
        </div>
      </div>

      <div className="grid gap-3 overflow-x-auto md:grid-cols-5">
        {LANES.map((lane) => (
          <div key={lane.id} className="panel flex min-w-[160px] flex-col">
            <p className="panel-title flex items-center justify-between border-b border-line px-3 py-2" style={{ color: ACCENTS[lane.accent].base }}>
              {lane.label}
              <span className="font-mono text-[10px] text-ink-faint">{lanes[lane.id].length}</span>
            </p>
            <div className="flex flex-col gap-2 p-2">
              {lanes[lane.id].length === 0 && <EmptyState title="Empty" compact />}
              {lanes[lane.id].slice(0, 20).map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setOpen(c.orchId)}
                  className="cursor-pointer rounded-xl border border-line px-2.5 py-2 text-left transition-colors hover:border-line-bright"
                  style={lane.id === "needs" ? { borderColor: ACCENTS.rose.border } : undefined}
                >
                  <span className="block text-xs font-semibold leading-4 text-ink">{c.title}</span>
                  <span className="mt-1.5 flex items-center gap-1.5">
                    <RolePill accent={c.roleAccent} text={c.role} />
                    <span className="truncate font-mono text-[10px] text-ink-faint">{c.meta}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {openOrch ? (
        <Panel
          title={`Goal · ${openOrch.status}`}
          right={
            <button type="button" onClick={() => setOpen(null)} className="cursor-pointer font-mono text-[10px] text-ink-faint hover:text-ink">
              Close ×
            </button>
          }
        >
          <div className="flex flex-col gap-3 p-4">
            <p className="text-sm font-semibold text-ink">{openOrch.goal}</p>
            {openOrch.plannerNote && <p className="text-[11px] text-ink-faint">{openOrch.plannerNote}</p>}
            {openOrch.steps.map((s) => (
              <div key={s.id} className="rounded-xl border border-line px-3 py-2">
                <p className="flex justify-between gap-2 text-xs font-semibold text-ink">
                  {s.title}
                  <span className="shrink-0 font-mono text-[10px] text-ink-faint">
                    {s.status}
                    {s.routedTo ? ` · ${s.routedTo}` : ""}
                  </span>
                </p>
                {s.feedback && <p className="pt-1 text-[11px]" style={{ color: ACCENTS.violet.base }}>Reviewer: {s.feedback}</p>}
              </div>
            ))}
            {openOrch.final && (
              <div className="rounded-xl border border-line px-3 py-2 text-xs">
                <Markdown>{openOrch.final.slice(0, 4000)}</Markdown>
              </div>
            )}
          </div>
        </Panel>
      ) : (
        orchs.length === 0 &&
        hub && (
          <p className="text-center text-[11px] text-ink-faint">
            No goals yet. The board runs on the same engine as the Orchestrator on the{" "}
            <Link href="/tasks" className="underline">
              Tasks
            </Link>{" "}
            page, so goals from either place show up in both.
          </p>
        )
      )}
    </div>
  );
}

function RolePill({ accent, text }: { accent: Accent; text: string }) {
  const c = ACCENTS[accent];
  return (
    <span className="inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 font-mono text-[10px] font-bold" style={{ background: c.soft, color: c.base }}>
      {text}
    </span>
  );
}
