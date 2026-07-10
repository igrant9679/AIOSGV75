"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ACCENTS, type Accent } from "@/lib/accents";
import type { Mission, MissionStrategy } from "@/lib/missions";
import type { Schedule, Frequency, Delivery } from "@/lib/schedules";
import Panel from "./ui/Panel";
import StatusOrb from "./ui/StatusOrb";
import NumberTicker from "./ui/NumberTicker";
import Avatar, { type AvatarKind } from "./Avatar";
import MicButton, { type MicState } from "./MicButton";
import { useMission } from "./store";
import { IconRocket } from "./icons";

interface Candidate {
  id: string;
  name: string;
  accent: Accent;
  kind?: AvatarKind;
  online: boolean;
}

const STRATEGIES: { id: MissionStrategy; label: string; hint: string }[] = [
  { id: "moa", label: "Mixture of Agents", hint: "all agents answer in parallel, a synthesizer merges the best of each" },
  { id: "pipeline", label: "Pipeline", hint: "agents run in sequence, each improving the previous output" },
  { id: "single", label: "Single", hint: "one agent handles the task" },
];

function statusAccent(s: string): Accent {
  if (s === "done") return "lime";
  if (s === "error") return "rose";
  if (s === "running") return "amber";
  return "cyan";
}

export default function MissionsSection() {
  const { system, agents, registry, addEvent } = useMission();
  const [missions, setMissions] = useState<Mission[]>([]);
  const [prompt, setPrompt] = useState("");
  const [strategy, setStrategy] = useState<MissionStrategy>("moa");
  const [selected, setSelected] = useState<string[]>([]);
  const [synthesizer, setSynthesizer] = useState("");
  const [launching, setLaunching] = useState(false);
  const [err, setErr] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [mic, setMic] = useState<MicState>({ listening: false, interim: "" });

  // scheduling
  const [mode, setMode] = useState<"now" | "schedule">("now");
  const [freq, setFreq] = useState<Frequency>("daily");
  const [time, setTime] = useState("09:00");
  const [weekday, setWeekday] = useState(1);
  const [deliver, setDeliver] = useState<Delivery>("telegram");
  const [schedules, setSchedules] = useState<Schedule[]>([]);

  const pollSchedules = useCallback(async () => {
    try {
      const res = await fetch("/api/schedules");
      if (res.ok) setSchedules(((await res.json()) as { schedules: Schedule[] }).schedules ?? []);
    } catch {
      /* server restarting */
    }
  }, []);
  useEffect(() => {
    pollSchedules();
    const iv = setInterval(pollSchedules, 15_000);
    return () => clearInterval(iv);
  }, [pollSchedules]);

  const candidates: Candidate[] = useMemo(
    () => [
      { id: "claude", name: "Claude", accent: "violet", kind: "claude" as AvatarKind, online: Boolean(system?.claudeVersion) },
      ...agents.map((a) => ({
        id: a.id,
        name: a.name,
        accent: a.accent,
        kind: (a.id === "openclaw" || a.id === "hermes" ? a.id : undefined) as AvatarKind | undefined,
        online: a.available,
      })),
      ...registry.llms.map((l) => ({ id: l.id, name: l.name, accent: l.accent, kind: undefined, online: l.hasKey })),
    ],
    [system, agents, registry],
  );

  const candidateById = useCallback((id: string) => candidates.find((c) => c.id === id), [candidates]);

  // default synthesizer: claude when online, else first online LLM
  useEffect(() => {
    if (synthesizer) return;
    const fallback = candidates.find((c) => c.online && (c.id === "claude" || registry.llms.some((l) => l.id === c.id)));
    if (fallback) setSynthesizer(fallback.id);
  }, [candidates, registry.llms, synthesizer]);

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/missions");
      if (res.ok) setMissions(((await res.json()) as { missions: Mission[] }).missions ?? []);
    } catch {
      /* server restarting */
    }
  }, []);

  const anyRunning = missions.some((m) => m.status === "running");
  useEffect(() => {
    poll();
    const iv = setInterval(poll, anyRunning ? 2000 : 8000);
    return () => clearInterval(iv);
  }, [poll, anyRunning]);

  const toggleAgent = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id].slice(-6)));

  const launch = async () => {
    setErr("");
    setLaunching(true);
    const payload = {
      prompt,
      strategy,
      agentIds: strategy === "single" ? selected.slice(0, 1) : selected,
      synthesizerId: strategy === "moa" ? synthesizer : undefined,
    };
    try {
      if (mode === "schedule") {
        const res = await fetch("/api/schedules", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, freq, time, weekday: freq === "weekly" ? weekday : undefined, deliver }),
        });
        const json = (await res.json()) as { ok?: boolean; error?: string };
        if (!res.ok || !json.ok) setErr(json.error ?? "schedule failed");
        else {
          addEvent("MISSIONS", `Schedule created — ${freq} ${freq === "hourly" ? "" : time}`, "lime");
          setPrompt("");
          pollSchedules();
        }
      } else {
        const res = await fetch("/api/missions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const json = (await res.json()) as { ok?: boolean; id?: string; error?: string };
        if (!res.ok || !json.ok) {
          setErr(json.error ?? "launch failed");
        } else {
          addEvent("MISSIONS", `Mission launched — ${strategy} with ${selected.length} agent(s)`, "cyan");
          setPrompt("");
          setExpanded(json.id ?? null);
          poll();
        }
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLaunching(false);
    }
  };

  const patchSchedule = async (body: Record<string, unknown>) => {
    await fetch("/api/schedules", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    pollSchedules();
    poll();
  };

  const canLaunch =
    prompt.trim().length > 0 &&
    selected.length >= (strategy === "single" ? 1 : 2) &&
    (strategy !== "moa" || Boolean(synthesizer)) &&
    !launching;

  const doneCount = missions.filter((m) => m.status === "done").length;

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_300px]">
      <div className="flex flex-col gap-4">
        {/* launcher */}
        <Panel title="New Mission">
          <div className="flex flex-col gap-3 p-4">
            <div
              className="rounded-2xl border border-line bg-panel-2 p-1.5 transition-colors focus-within:border-line-bright"
              style={mic.listening ? { borderColor: "rgba(251,113,133,0.4)" } : undefined}
            >
              <div className="flex items-end gap-1.5">
                <textarea
                  value={mic.listening && mic.interim ? `${prompt ? prompt + " " : ""}${mic.interim}` : prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={3}
                  placeholder={mic.listening ? "Listening…" : "Describe the task for your agent fleet…"}
                  aria-label="Mission task"
                  className="min-h-16 flex-1 resize-none bg-transparent px-3 py-2 text-[13.5px] leading-6 text-ink outline-none placeholder:text-ink-faint"
                />
                <MicButton onFinal={(t) => setPrompt((p) => (p ? `${p.replace(/\s+$/, "")} ${t}` : t))} onState={setMic} />
              </div>
            </div>

            {/* strategy */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="panel-title">Strategy</span>
              <div className="flex overflow-hidden rounded-lg border border-line" role="radiogroup" aria-label="Strategy">
                {STRATEGIES.map((s) => (
                  <button
                    key={s.id}
                    role="radio"
                    aria-checked={strategy === s.id}
                    title={s.hint}
                    onClick={() => setStrategy(s.id)}
                    className={`cursor-pointer px-3 py-1.5 font-mono text-[10.5px] tracking-wide transition-colors ${
                      strategy === s.id ? "bg-neon-cyan/15 text-neon-cyan" : "text-ink-faint hover:bg-white/[0.04]"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <span className="text-[10.5px] text-ink-faint">{STRATEGIES.find((s) => s.id === strategy)?.hint}</span>
            </div>

            {/* agent picker */}
            <div>
              <span className="panel-title">
                {strategy === "pipeline" ? "Agents (runs in selection order)" : "Agents"}
              </span>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {candidates.map((c) => {
                  const on = selected.includes(c.id);
                  const idx = selected.indexOf(c.id);
                  const col = ACCENTS[c.accent];
                  return (
                    <button
                      key={c.id}
                      onClick={() => c.online && toggleAgent(c.id)}
                      disabled={!c.online}
                      aria-pressed={on}
                      title={c.online ? c.name : `${c.name} is offline`}
                      className="flex cursor-pointer items-center gap-2 rounded-xl border px-2.5 py-1.5 text-xs font-medium transition-all disabled:cursor-not-allowed disabled:opacity-30"
                      style={{
                        borderColor: on ? `${col.base}88` : "var(--color-line)",
                        background: on ? col.soft : "transparent",
                        color: on ? col.base : "var(--color-ink-dim)",
                      }}
                    >
                      <Avatar kind={c.kind} name={c.name} accent={c.accent} size={20} />
                      {c.name}
                      {on && strategy === "pipeline" && (
                        <span className="rounded bg-white/10 px-1 font-mono text-[9px]">{idx + 1}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* run mode */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="panel-title">When</span>
              <div className="flex overflow-hidden rounded-lg border border-line" role="radiogroup" aria-label="Run mode">
                {(["now", "schedule"] as const).map((m) => (
                  <button
                    key={m}
                    role="radio"
                    aria-checked={mode === m}
                    onClick={() => setMode(m)}
                    className={`cursor-pointer px-3 py-1.5 font-mono text-[10.5px] tracking-wide transition-colors ${
                      mode === m ? "bg-neon-lime/15 text-neon-lime" : "text-ink-faint hover:bg-white/[0.04]"
                    }`}
                  >
                    {m === "now" ? "Run now" : "On a schedule"}
                  </button>
                ))}
              </div>
              {mode === "schedule" && (
                <>
                  <select
                    value={freq}
                    onChange={(e) => setFreq(e.target.value as Frequency)}
                    aria-label="Frequency"
                    className="cursor-pointer rounded-lg border border-line bg-panel-2 px-2 py-1.5 font-mono text-[11px] text-ink-dim outline-none"
                  >
                    <option value="hourly">Hourly</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                  </select>
                  {freq === "weekly" && (
                    <select
                      value={weekday}
                      onChange={(e) => setWeekday(Number(e.target.value))}
                      aria-label="Weekday"
                      className="cursor-pointer rounded-lg border border-line bg-panel-2 px-2 py-1.5 font-mono text-[11px] text-ink-dim outline-none"
                    >
                      {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d, i) => (
                        <option key={d} value={i}>
                          {d}
                        </option>
                      ))}
                    </select>
                  )}
                  {freq !== "hourly" && (
                    <input
                      type="time"
                      value={time}
                      onChange={(e) => setTime(e.target.value)}
                      aria-label="Time"
                      className="rounded-lg border border-line bg-panel-2 px-2 py-1 font-mono text-[11px] text-ink-dim outline-none"
                    />
                  )}
                  <select
                    value={deliver}
                    onChange={(e) => setDeliver(e.target.value as Delivery)}
                    aria-label="Delivery"
                    className="cursor-pointer rounded-lg border border-line bg-panel-2 px-2 py-1.5 font-mono text-[11px] text-ink-dim outline-none"
                  >
                    <option value="telegram">→ Telegram (via OpenClaw)</option>
                    <option value="vault">→ Vault only</option>
                  </select>
                </>
              )}
            </div>

            {/* synthesizer + launch */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              {strategy === "moa" ? (
                <label className="flex items-center gap-2 font-mono text-[10.5px] text-ink-faint">
                  SYNTHESIZER
                  <select
                    value={synthesizer}
                    onChange={(e) => setSynthesizer(e.target.value)}
                    className="cursor-pointer rounded-lg border border-line bg-panel-2 px-2 py-1.5 font-mono text-[11px] text-ink-dim outline-none focus:border-line-bright"
                  >
                    {candidates
                      .filter((c) => c.online)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                </label>
              ) : (
                <span />
              )}
              <motion.button
                whileTap={{ scale: 0.96 }}
                onClick={launch}
                disabled={!canLaunch}
                className="flex cursor-pointer items-center gap-2 rounded-xl bg-gradient-to-br from-cyan-600 to-neon-cyan px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-35"
              >
                <IconRocket width={16} height={16} />
                {launching ? "Working…" : mode === "schedule" ? "Create Schedule" : "Launch Mission"}
              </motion.button>
            </div>
            {err && (
              <p role="alert" className="rounded-lg border border-neon-rose/30 bg-neon-rose/10 px-3 py-2 font-mono text-[11px] text-neon-rose">
                {err}
              </p>
            )}
          </div>
        </Panel>

        {/* mission list */}
        <Panel title="Mission Log" delay={0.05}>
          <div className="flex flex-col gap-2 p-4">
            {missions.length === 0 && (
              <p className="py-8 text-center text-xs text-ink-faint">
                No missions yet. Pick 2+ agents, describe a task, and launch.
              </p>
            )}
            <AnimatePresence initial={false}>
              {missions.map((m) => {
                const open = expanded === m.id;
                return (
                  <motion.div
                    key={m.id}
                    layout
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="overflow-hidden rounded-xl border border-line bg-white/[0.02]"
                  >
                    <button
                      onClick={() => setExpanded(open ? null : m.id)}
                      aria-expanded={open}
                      className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.02]"
                    >
                      <StatusOrb accent={statusAccent(m.status)} pulsing={m.status === "running"} size={9} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink">{m.title}</p>
                        <p className="font-mono text-[10px] text-ink-faint">
                          {m.strategy.toUpperCase()} ·{" "}
                          {new Date(m.createdAt).toLocaleTimeString("en-US", { hour12: false })}
                          {m.finishedAt ? ` · ${((m.finishedAt - m.createdAt) / 1000).toFixed(0)}s` : " · running"}
                        </p>
                      </div>
                      <div className="flex -space-x-1.5">
                        {m.results.map((r) => {
                          const c = candidateById(r.agentId);
                          return (
                            <span key={r.agentId} title={`${r.agentId}: ${r.status}`} className="relative">
                              <Avatar kind={c?.kind} name={c?.name ?? r.agentId} accent={c?.accent ?? "cyan"} size={24} />
                              <span
                                className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-void"
                                style={{ background: ACCENTS[statusAccent(r.status)].base }}
                              />
                            </span>
                          );
                        })}
                      </div>
                    </button>

                    {open && (
                      <div className="flex flex-col gap-3 border-t border-line px-4 py-3">
                        <p className="whitespace-pre-wrap rounded-lg bg-white/[0.02] px-3 py-2 font-mono text-[11px] leading-5 text-ink-dim">
                          {m.prompt}
                        </p>
                        {m.results.map((r) => {
                          const c = candidateById(r.agentId);
                          return (
                            <div key={r.agentId} className="rounded-xl border border-line p-3">
                              <div className="mb-1.5 flex items-center gap-2">
                                <Avatar kind={c?.kind} name={c?.name ?? r.agentId} accent={c?.accent ?? "cyan"} size={20} />
                                <span className="text-xs font-semibold" style={{ color: ACCENTS[c?.accent ?? "cyan"].base }}>
                                  {c?.name ?? r.agentId}
                                </span>
                                <span className="font-mono text-[9.5px] text-ink-faint">
                                  {r.status === "done" ? `${(r.ms / 1000).toFixed(1)}s` : r.status}
                                </span>
                              </div>
                              <div className="max-h-56 overflow-y-auto whitespace-pre-wrap text-[12.5px] leading-6 text-ink">
                                {r.error ? <span className="text-neon-rose">{r.error}</span> : r.text || "…"}
                              </div>
                            </div>
                          );
                        })}
                        {m.synthesis && m.strategy !== "single" && (
                          <div className="rounded-xl border border-neon-violet/40 bg-neon-violet/[0.07] p-3">
                            <p className="mb-1.5 font-mono text-[10px] tracking-[0.18em] text-neon-violet">
                              {m.strategy === "moa" ? "✦ SYNTHESIS" : "✦ FINAL OUTPUT"}
                            </p>
                            <div className="max-h-72 overflow-y-auto whitespace-pre-wrap text-[13px] leading-6 text-ink">
                              {m.synthesis}
                            </div>
                          </div>
                        )}
                        {m.synthesisError && (
                          <p className="font-mono text-[11px] text-neon-rose">synthesizer failed: {m.synthesisError}</p>
                        )}
                        {m.vaultFile && (
                          <p className="font-mono text-[10px] text-ink-faint">saved to vault · Agentic OS/Missions</p>
                        )}
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        </Panel>
      </div>

      <div className="flex flex-col gap-4">
        <Panel title="Fleet Status" delay={0.05}>
          <div className="grid grid-cols-2 gap-4 p-4">
            <div>
              <p className="panel-title">Missions Flown</p>
              <p className="font-mono text-xl font-bold text-neon-cyan">
                <NumberTicker value={doneCount} />
              </p>
            </div>
            <div>
              <p className="panel-title">Agents Ready</p>
              <p className="font-mono text-xl font-bold text-neon-lime">
                <NumberTicker value={candidates.filter((c) => c.online).length} />
              </p>
            </div>
          </div>
        </Panel>

        <Panel title="Schedules" delay={0.08}>
          <div className="flex flex-col gap-2 p-3">
            {schedules.length === 0 && (
              <p className="px-2 py-4 text-center text-[11px] leading-5 text-ink-faint">
                None yet. Switch the launcher to &ldquo;On a schedule&rdquo; to run a mission hourly, daily, or weekly —
                with results sent to your Telegram.
              </p>
            )}
            {schedules.map((s) => (
              <div key={s.id} className="rounded-xl border border-line bg-white/[0.02] p-3">
                <div className="flex items-center gap-2">
                  <StatusOrb accent={s.enabled ? "lime" : "rose"} pulsing={false} size={7} />
                  <p className="min-w-0 flex-1 truncate text-xs font-semibold text-ink">{s.title}</p>
                  <button
                    onClick={() => patchSchedule({ id: s.id, enabled: !s.enabled })}
                    className={`cursor-pointer rounded px-1.5 py-0.5 font-mono text-[9px] tracking-wide transition-colors ${
                      s.enabled ? "bg-neon-lime/15 text-neon-lime" : "bg-white/5 text-ink-faint"
                    }`}
                    aria-pressed={s.enabled}
                  >
                    {s.enabled ? "ON" : "OFF"}
                  </button>
                  <button
                    onClick={() => {
                      fetch(`/api/schedules?id=${s.id}`, { method: "DELETE" }).then(pollSchedules);
                    }}
                    aria-label={`Delete schedule ${s.title}`}
                    className="cursor-pointer rounded p-1 text-ink-faint transition-colors hover:text-neon-rose"
                  >
                    <span className="font-mono text-[10px]">✕</span>
                  </button>
                </div>
                <p className="mt-1.5 font-mono text-[9.5px] leading-4 text-ink-faint">
                  {s.freq.toUpperCase()}
                  {s.freq !== "hourly" ? ` ${s.time}` : ""}
                  {s.freq === "weekly" ? ` ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][s.weekday ?? 1]}` : ""}
                  {" · "}
                  {s.deliver === "telegram" ? "→ Telegram" : "→ vault"}
                  <br />
                  next {new Date(s.nextRun).toLocaleString("en-US", { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false })}
                  {s.lastStatus ? ` · last: ${s.lastStatus}` : ""}
                </p>
                <button
                  onClick={() => patchSchedule({ id: s.id, runNow: true })}
                  className="mt-2 cursor-pointer rounded-lg border border-line px-2 py-1 font-mono text-[9.5px] text-neon-cyan transition-colors hover:bg-neon-cyan/10"
                >
                  ▶ Run now
                </button>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Strategies" delay={0.1}>
          <div className="flex flex-col gap-3 p-4 text-[11.5px] leading-5 text-ink-dim">
            <p>
              <span className="font-semibold text-neon-cyan">Mixture of Agents</span> — every selected agent answers
              independently; the synthesizer merges strengths and fixes disagreements. Best for hard questions.
            </p>
            <p>
              <span className="font-semibold text-neon-magenta">Pipeline</span> — draft → improve → polish, in your
              selection order. Best for writing and code.
            </p>
            <p>
              Each agent gets relevant shared memory injected, and results are archived to{" "}
              <span className="font-mono">Agentic OS/Missions/</span> in your vault.
            </p>
          </div>
        </Panel>
      </div>
    </div>
  );
}
