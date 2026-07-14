"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { motion } from "framer-motion";
import { ACCENTS, type Accent } from "@/lib/accents";
import type { BoardTask, BoardStatus } from "@/lib/tasks";
import Panel from "./ui/Panel";
import NumberTicker from "./ui/NumberTicker";
import EmptyState from "./ui/EmptyState";
import { celebrate } from "./ui/Celebration";
import OrchestratorPanel from "./OrchestratorPanel";
import { IconPlus, IconTrash } from "./icons";
import { useMission } from "./store";

/** Scope the panel accent (top edge, title tick, hover glow) to one color. */
const accentVar = (a: Accent): CSSProperties => ({ "--page-accent": ACCENTS[a].base }) as CSSProperties;

const LANES: { status: BoardStatus; label: string; accent: Accent }[] = [
  { status: "pending", label: "Pending", accent: "amber" },
  { status: "in_progress", label: "In Progress", accent: "cyan" },
  { status: "done", label: "Done", accent: "lime" },
];

const NEXT: Record<BoardStatus, BoardStatus | null> = { pending: "in_progress", in_progress: "done", done: null };
const PREV: Record<BoardStatus, BoardStatus | null> = { pending: null, in_progress: "pending", done: "in_progress" };

function ago(ts: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

interface ScheduleLite {
  id: string;
  title: string;
  enabled: boolean;
  nextRun: number;
}

export default function TasksSection() {
  const { addEvent } = useMission();
  const [tasks, setTasks] = useState<BoardTask[]>([]);
  const [schedules, setSchedules] = useState<ScheduleLite[]>([]);
  const [title, setTitle] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [dragOver, setDragOver] = useState<BoardStatus | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/tasks");
      if (res.ok) setTasks(((await res.json()) as { tasks: BoardTask[] }).tasks ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 10_000);
    const clock = setInterval(() => setNow(Date.now()), 30_000);
    fetch("/api/schedules")
      .then((r) => r.json())
      .then((j: { schedules: ScheduleLite[] }) => setSchedules(j.schedules ?? []))
      .catch(() => {});
    return () => {
      clearInterval(t);
      clearInterval(clock);
    };
  }, [load]);

  const add = async () => {
    const t = title.trim();
    if (!t) return;
    setTitle("");
    await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: t }),
    });
    addEvent("TASKS", `Task added: ${t.slice(0, 60)}`, "amber");
    load();
  };

  const move = async (task: BoardTask, status: BoardStatus) => {
    setTasks((prev) => prev.map((x) => (x.id === task.id ? { ...x, status, updatedAt: Date.now() } : x)));
    await fetch("/api/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: task.id, status }),
    });
    if (status === "done") {
      addEvent("TASKS", `Task done: ${task.title.slice(0, 60)}`, "lime");
      celebrate("lime");
    }
    load();
  };

  const dropOn = (status: BoardStatus) => (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(null);
    const id = e.dataTransfer.getData("text/plain");
    const task = tasks.find((t) => t.id === id);
    if (task && task.status !== status) move(task, status);
  };

  const remove = async (task: BoardTask) => {
    setTasks((prev) => prev.filter((x) => x.id !== task.id));
    await fetch(`/api/tasks?id=${encodeURIComponent(task.id)}`, { method: "DELETE" });
    load();
  };

  const nextCron = useMemo(() => {
    const enabled = schedules.filter((s) => s.enabled && s.nextRun > now);
    if (enabled.length === 0) return null;
    return enabled.reduce((a, b) => (a.nextRun < b.nextRun ? a : b));
  }, [schedules, now]);

  const countdown = nextCron ? Math.max(0, nextCron.nextRun - now) : null;
  const countdownLabel =
    countdown === null ? "—" : countdown < 3_600_000 ? `in ${Math.max(1, Math.round(countdown / 60_000))}m` : `in ${Math.round(countdown / 3_600_000)}h`;

  const doneCount = tasks.filter((t) => t.status === "done").length;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div style={accentVar("amber")}>
          <Panel title="Kanban Tasks">
            <div className="p-4" style={{ background: `radial-gradient(150px 80px at 100% 0%, ${ACCENTS.amber.soft}, transparent 70%)` }}>
              <span style={{ color: ACCENTS.amber.base }}>
                <NumberTicker value={tasks.length} className="text-3xl font-bold" />
              </span>
              <p className="pt-1 font-mono text-[10px] tracking-[0.14em] text-ink-faint">OPERATOR BOARD</p>
            </div>
          </Panel>
        </div>
        <div style={accentVar("cyan")}>
          <Panel title="Cron Jobs" delay={0.04}>
            <div className="p-4" style={{ background: `radial-gradient(150px 80px at 100% 0%, ${ACCENTS.cyan.soft}, transparent 70%)` }}>
              <span style={{ color: ACCENTS.cyan.base }}>
                <NumberTicker value={schedules.length} className="text-3xl font-bold" />
              </span>
              <p className="pt-1 font-mono text-[10px] tracking-[0.14em] text-ink-faint">SCHEDULED JOBS</p>
            </div>
          </Panel>
        </div>
        <div style={accentVar("lime")}>
          <Panel title="Done" delay={0.08}>
            <div className="p-4" style={{ background: `radial-gradient(150px 80px at 100% 0%, ${ACCENTS.lime.soft}, transparent 70%)` }}>
              <span style={{ color: ACCENTS.lime.base }}>
                <NumberTicker value={doneCount} className="text-3xl font-bold" />
              </span>
              <p className="pt-1 font-mono text-[10px] tracking-[0.14em] text-ink-faint">
                {tasks.filter((t) => t.status === "in_progress").length} IN PROGRESS
              </p>
            </div>
          </Panel>
        </div>
        <div style={accentVar("violet")}>
          <Panel title="Next Cron" delay={0.12}>
            <div className="p-4" style={{ background: `radial-gradient(150px 80px at 100% 0%, ${ACCENTS.violet.soft}, transparent 70%)` }}>
              <p className="text-3xl font-bold" style={{ color: ACCENTS.violet.base }}>
                {countdownLabel}
              </p>
              <p className="truncate pt-1 font-mono text-[10px] tracking-[0.14em] text-ink-faint">
                {nextCron ? nextCron.title.toUpperCase() : "NO ENABLED SCHEDULES"}
              </p>
            </div>
          </Panel>
        </div>
      </div>

      <OrchestratorPanel delay={0.14} />

      <div className="flex items-center gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
          placeholder="Add a task…"
          aria-label="New task title"
          className="h-10 w-72 rounded-lg border border-line bg-panel-2 px-3 font-mono text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-line-bright"
        />
        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={add}
          disabled={!title.trim()}
          aria-label="Add task"
          className="flex h-10 cursor-pointer items-center gap-2 rounded-lg bg-gradient-to-br from-amber-600 to-neon-amber px-4 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-35"
        >
          <IconPlus width={15} height={15} /> Add Task
        </motion.button>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        {LANES.map((lane, i) => {
          const laneTasks = tasks.filter((t) => t.status === lane.status);
          const lc = ACCENTS[lane.accent];
          return (
            <div key={lane.status} style={accentVar(lane.accent)}>
            <Panel
              title={lane.label}
              right={
                <span
                  className="rounded-full px-2 py-0.5 font-mono text-[10px] font-bold"
                  style={{ background: lc.soft, color: lc.base }}
                >
                  {laneTasks.length}
                </span>
              }
              delay={0.1 + i * 0.04}
            >
              <div
                className="flex min-h-24 flex-col gap-2 rounded-b-[inherit] p-3 transition-colors"
                style={dragOver === lane.status ? { background: lc.soft } : undefined}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (dragOver !== lane.status) setDragOver(lane.status);
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(null);
                }}
                onDrop={dropOn(lane.status)}
              >
                {laneTasks.length === 0 && (
                  <EmptyState
                    compact
                    accent={lane.accent}
                    title={dragOver === lane.status ? "Drop it here" : "Lane clear"}
                    hint={lane.status === "pending" ? "Add a task above, drag one in, or let the Orchestrator file one." : "Drag cards here."}
                  />
                )}
                {laneTasks.map((task) => (
                  <div
                    key={task.id}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData("text/plain", task.id)}
                    onDragEnd={() => setDragOver(null)}
                    className="group cursor-grab rounded-xl border border-line px-3 py-2.5 transition-[transform,border-color] hover:-translate-y-0.5 hover:border-line-bright active:cursor-grabbing"
                    style={{
                      borderLeft: `3px solid ${lc.base}`,
                      background: `radial-gradient(140px 60px at 0% 0%, ${lc.soft}, transparent 75%)`,
                    }}
                  >
                    <div className="flex items-start gap-2">
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: ACCENTS[lane.accent].base }} />
                      <p className="min-w-0 flex-1 text-sm leading-5 text-ink">{task.title}</p>
                      <button
                        onClick={() => remove(task)}
                        aria-label={`Delete task: ${task.title}`}
                        className="cursor-pointer rounded p-1 text-ink-faint opacity-0 transition-opacity hover:text-neon-rose group-hover:opacity-100"
                      >
                        <IconTrash width={12} height={12} />
                      </button>
                    </div>
                    <div className="flex items-center justify-between pt-1.5 pl-4">
                      <span className="font-mono text-[10px] tracking-[0.1em] text-ink-faint">{ago(task.updatedAt)}</span>
                      <span className="flex gap-1">
                        {PREV[task.status] && (
                          <button
                            onClick={() => move(task, PREV[task.status]!)}
                            aria-label="Move task left"
                            className="cursor-pointer rounded-md border border-line px-2 py-0.5 font-mono text-[10px] text-ink-dim transition-colors hover:bg-white/[0.06]"
                          >
                            ◀
                          </button>
                        )}
                        {NEXT[task.status] && (
                          <button
                            onClick={() => move(task, NEXT[task.status]!)}
                            aria-label="Move task right"
                            className="cursor-pointer rounded-md border border-line px-2 py-0.5 font-mono text-[10px] text-ink-dim transition-colors hover:bg-white/[0.06]"
                          >
                            ▶
                          </button>
                        )}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
            </div>
          );
        })}
      </div>
    </div>
  );
}
