"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ACCENTS } from "@/lib/accents";
import type { GoalRun } from "@/lib/goalmode";
import Panel from "./ui/Panel";
import StatusOrb from "./ui/StatusOrb";
import MicButton from "./MicButton";
import DaemonsPanel from "./DaemonsPanel";
import { IconStop, IconRocket } from "./icons";
import { useMission } from "./store";

/** Hermes Lab — Goal Mode (autonomous long-horizon runs) + Control Room (native dashboard). */

const DASHBOARD_URL = "http://127.0.0.1:9119";

function ago(ts: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export default function HermesLabSection() {
  const { agents, addEvent } = useMission();
  const hermes = agents.find((a) => a.id === "hermes");
  const [tab, setTab] = useState<"goals" | "control">("goals");
  const [runs, setRuns] = useState<GoalRun[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [goal, setGoal] = useState("");
  const [maxTurns, setMaxTurns] = useState(50);
  const [err, setErr] = useState("");
  const [dashUp, setDashUp] = useState<boolean | null>(null);
  const [startingDash, setStartingDash] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);

  const startDashboard = async () => {
    setStartingDash(true);
    setErr("");
    try {
      const res = await fetch("/api/daemons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "hermes-dashboard" }),
      });
      const j = (await res.json()) as { ok?: boolean; error?: string };
      if (j.ok) {
        addEvent("SERVICES", "Hermes dashboard started", "lime");
        setDashUp(true);
      } else setErr(j.error ?? "could not start the dashboard");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setStartingDash(false);
    }
  };

  const anyRunning = runs.some((r) => r.status === "running");
  const activeRun = useMemo(() => runs.find((r) => r.id === open) ?? null, [runs, open]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/goalmode");
      if (res.ok) setRuns(((await res.json()) as { runs: GoalRun[] }).runs ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, anyRunning ? 3_000 : 15_000);
    return () => clearInterval(t);
  }, [load, anyRunning]);

  // auto-scroll live log
  useEffect(() => {
    if (activeRun?.status === "running") logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [activeRun?.log, activeRun?.status]);

  // probe the native dashboard when the Control tab opens
  useEffect(() => {
    if (tab !== "control") return;
    let cancelled = false;
    fetch(DASHBOARD_URL, { mode: "no-cors" })
      .then(() => !cancelled && setDashUp(true))
      .catch(() => !cancelled && setDashUp(false));
    return () => {
      cancelled = true;
    };
  }, [tab]);

  const launch = async () => {
    const g = goal.trim();
    if (!g) return;
    setErr("");
    const res = await fetch("/api/goalmode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal: g, maxTurns }),
    });
    const json = (await res.json()) as { ok?: boolean; id?: string; error?: string };
    if (!res.ok || !json.ok) {
      setErr(json.error ?? "launch failed");
      return;
    }
    setGoal("");
    addEvent("HERMES", `Goal launched: ${g.slice(0, 60)}`, "amber");
    setOpen(json.id ?? null);
    load();
  };

  const stop = async (id: string) => {
    await fetch(`/api/goalmode?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    load();
  };

  return (
    <div className="flex flex-col gap-4">
      <DaemonsPanel />
      <Panel title="Hermes Lab">
        <div className="flex flex-col gap-3 p-4">
          <div className="flex items-center gap-3">
            <StatusOrb accent={hermes?.available ? "lime" : "rose"} pulsing={false} size={9} />
            <span className="text-sm text-ink-dim">
              {hermes?.available ? `Hermes online · ${(hermes.version ?? "").split("·")[0].trim()}` : "Hermes offline on this machine"}
            </span>
            <div className="ml-auto flex rounded-xl border border-line p-1">
              {(["goals", "control"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className="cursor-pointer rounded-lg px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.1em] transition-colors"
                  style={tab === t ? { background: ACCENTS.amber.soft, color: ACCENTS.amber.base } : { color: "var(--color-ink-faint)" }}
                >
                  {t === "goals" ? "Goal Mode" : "Control Room"}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Panel>

      {tab === "goals" ? (
        <>
          <Panel title="Set the target. Walk away." right={<span className="font-mono text-[10px] text-ink-faint">hermes chat --yolo --max-turns · own scratch dir</span>} delay={0.05}>
            <div className="flex flex-col gap-3 p-4">
              <p className="text-[12px] leading-5 text-ink-faint">
                Hand Hermes a long-horizon goal. It runs autonomously in its own scratch directory — close your laptop, come back to
                finished work. Output tails live below; files it writes show up as artifacts.
              </p>
              {err && <p className="rounded-lg border border-neon-rose/30 bg-neon-rose/10 px-3 py-1.5 font-mono text-[11px] text-neon-rose">{err}</p>}
              <div className="flex items-start gap-2">
                <textarea
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  rows={3}
                  placeholder="Be specific. e.g. Research the top 5 open-source AI agent frameworks, write a comparison table with pros/cons and a recommendation, and save it as comparison.md with frontmatter."
                  className="min-h-20 w-full resize-none rounded-xl border border-line bg-panel-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-line-bright"
                  disabled={!hermes?.available}
                />
                <div className="flex flex-col items-stretch gap-2">
                  <MicButton onFinal={(t) => setGoal((g) => (g ? `${g} ${t}` : t))} />
                  <label className="flex flex-col gap-1 rounded-lg border border-line px-2 py-1">
                    <span className="font-mono text-[9px] tracking-[0.1em] text-ink-faint">MAX TURNS</span>
                    <input
                      type="number"
                      min={5}
                      max={200}
                      value={maxTurns}
                      onChange={(e) => setMaxTurns(Number(e.target.value))}
                      className="w-20 bg-transparent font-mono text-sm text-ink outline-none"
                    />
                  </label>
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    onClick={launch}
                    disabled={!goal.trim() || !hermes?.available}
                    className="cursor-pointer rounded-xl bg-gradient-to-br from-amber-600 to-neon-amber px-4 py-2.5 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    Launch goal
                  </motion.button>
                </div>
              </div>
            </div>
          </Panel>

          <div className="grid gap-4 xl:grid-cols-[280px_1fr]">
            <Panel title="Goals" right={<span className="font-mono text-[11px] text-ink-faint">{runs.length}</span>} delay={0.08}>
              <div className="flex max-h-[520px] flex-col gap-1.5 overflow-y-auto p-3">
                {runs.length === 0 && <p className="py-6 text-center text-xs text-ink-faint">No goals yet.</p>}
                {runs.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => setOpen(r.id)}
                    className="flex cursor-pointer items-center gap-2 rounded-xl border border-line bg-white/[0.02] px-3 py-2 text-left transition-colors hover:border-line-bright"
                    style={open === r.id ? { borderColor: ACCENTS.amber.base } : undefined}
                  >
                    <StatusOrb accent={r.status === "running" ? "amber" : r.status === "done" ? "lime" : "rose"} pulsing={r.status === "running"} size={7} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold text-ink">{r.goal}</span>
                      <span className="font-mono text-[10px] text-ink-faint">{r.status} · {ago(r.createdAt)}</span>
                    </span>
                  </button>
                ))}
              </div>
            </Panel>

            <Panel
              title={activeRun ? "Live run" : "Watch a goal"}
              right={
                activeRun?.status === "running" ? (
                  <button onClick={() => stop(activeRun.id)} className="flex cursor-pointer items-center gap-1 rounded-md border border-neon-rose/40 px-2 py-0.5 font-mono text-[10px] text-neon-rose hover:bg-neon-rose/10">
                    <IconStop width={11} height={11} /> stop
                  </button>
                ) : undefined
              }
              delay={0.1}
            >
              <div className="p-4">
                {!activeRun && <p className="py-16 text-center text-sm text-ink-faint">Pick a goal to watch its output live.</p>}
                {activeRun && (
                  <>
                    <p className="pb-2 text-sm text-ink">{activeRun.goal}</p>
                    <p className="pb-2 font-mono text-[10px] text-ink-faint">
                      {activeRun.status}{activeRun.exitCode != null ? ` · exit ${activeRun.exitCode}` : ""} · scratch: {activeRun.scratchDir}
                    </p>
                    <pre ref={logRef} className="max-h-[420px] overflow-auto rounded-xl border border-line bg-black/40 p-3 font-mono text-[11px] leading-4 text-ink-dim">
                      {activeRun.log || (activeRun.status === "running" ? "starting…" : "(no output)")}
                    </pre>
                  </>
                )}
              </div>
            </Panel>
          </div>
        </>
      ) : (
        <Panel
          title="Hermes Control Room"
          right={
            <span className="flex items-center gap-2 font-mono text-[10px] text-ink-faint">
              <StatusOrb accent={dashUp === null ? "cyan" : dashUp ? "lime" : "rose"} pulsing={dashUp === null} size={7} />
              {DASHBOARD_URL}
              <a href={DASHBOARD_URL} target="_blank" className="rounded-md border border-line px-2 py-0.5 text-ink-dim hover:bg-white/[0.06]">open ↗</a>
            </span>
          }
          delay={0.05}
        >
          <div className="p-4">
            <p className="pb-3 text-[12px] leading-5 text-ink-faint">
              Hermes ships its own local dashboard — sessions, models, files, logs, cron, skills, plugins, and MCP — served at{" "}
              <span className="font-mono">{DASHBOARD_URL}</span>. Start it with <span className="font-mono text-neon-amber">hermes dashboard</span> in a
              terminal, then it appears below.
            </p>
            {dashUp === false ? (
              hermes?.available ? (
                <div className="flex flex-col items-center gap-3 rounded-xl border border-line bg-white/[0.02] p-8 text-center">
                  <p className="text-sm text-ink-dim">Dashboard not running.</p>
                  <motion.button
                    whileTap={{ scale: 0.96 }}
                    onClick={startDashboard}
                    disabled={startingDash}
                    className="flex cursor-pointer items-center gap-2 rounded-lg bg-gradient-to-br from-amber-600 to-neon-amber px-4 py-2 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <IconRocket width={15} height={15} /> {startingDash ? "Starting…" : "Start dashboard"}
                  </motion.button>
                  <p className="font-mono text-[11px] text-ink-faint">or run <span className="text-neon-amber">hermes dashboard --skip-build --no-open</span> in a terminal (port 9119) — it also auto-starts on boot now.</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3 rounded-xl border border-line bg-white/[0.02] p-8 text-center">
                  <p className="text-sm text-ink-dim">Hermes isn&apos;t installed on this machine.</p>
                  <p className="max-w-lg font-mono text-[11px] leading-5 text-ink-faint">
                    The Control Room runs wherever Hermes is installed. To use it here, install the Nous Hermes Agent on this
                    machine and set <span className="text-neon-amber">HERMES_BIN</span> in <span className="text-neon-amber">.env.local</span> —
                    then it starts here automatically. (This is about what&apos;s installed, not the machine&apos;s group role.)
                  </p>
                </div>
              )
            ) : (
              <iframe
                src={DASHBOARD_URL}
                title="Hermes native dashboard"
                className="h-[640px] w-full rounded-xl border border-line bg-white"
              />
            )}
          </div>
        </Panel>
      )}
    </div>
  );
}
