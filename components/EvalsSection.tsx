"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ACCENTS, type Accent } from "@/lib/accents";
import type { EvalCase, EvalRun } from "@/lib/evals";
import Panel from "./ui/Panel";
import Avatar, { type AvatarKind } from "./Avatar";
import StatusOrb from "./ui/StatusOrb";
import EmptyState from "./ui/EmptyState";
import { useMission } from "./store";
import { IconPlus, IconTrash, IconCheck } from "./icons";

const inputCls =
  "h-9 w-full rounded-lg border border-line bg-panel-2 px-3 font-mono text-[11.5px] text-ink outline-none placeholder:text-ink-faint focus:border-line-bright";

export default function EvalsSection() {
  const { system, agents, registry, addEvent } = useMission();
  const [cases, setCases] = useState<EvalCase[]>([]);
  const [runs, setRuns] = useState<EvalRun[]>([]);
  const [selected, setSelected] = useState<string[]>(["claude"]);
  const [starting, setStarting] = useState(false);
  const [caseName, setCaseName] = useState("");
  const [casePrompt, setCasePrompt] = useState("");
  const [caseCriteria, setCaseCriteria] = useState("");

  const candidates = useMemo(
    () => [
      { id: "claude", name: "Claude", accent: "violet" as Accent, kind: "claude" as AvatarKind, online: Boolean(system?.claudeVersion) },
      { id: "auto", name: "Auto", accent: "cyan" as Accent, kind: undefined, online: true },
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

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/evals");
      if (res.ok) {
        const d = (await res.json()) as { cases: EvalCase[]; runs: EvalRun[] };
        setCases(d.cases ?? []);
        setRuns(d.runs ?? []);
      }
    } catch {
      /* ignore */
    }
  }, []);
  const running = runs.some((r) => r.status === "running");
  useEffect(() => {
    poll();
    const iv = setInterval(poll, running ? 4000 : 20000);
    return () => clearInterval(iv);
  }, [poll, running]);

  const run = async () => {
    setStarting(true);
    try {
      const res = await fetch("/api/evals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ run: { agentIds: selected } }),
      });
      if (res.ok) {
        addEvent("EVALS", `Eval run started — ${selected.length} agent(s) × ${cases.length} cases`, "cyan");
        poll();
      }
    } finally {
      setStarting(false);
    }
  };

  const addNewCase = async () => {
    const res = await fetch("/api/evals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ addCase: { name: caseName, prompt: casePrompt, criteria: caseCriteria } }),
    });
    if (res.ok) {
      setCaseName("");
      setCasePrompt("");
      setCaseCriteria("");
      poll();
    }
  };

  const latest = [...runs].reverse().find((r) => r.scores.length > 0);
  const latestByAgent = useMemo(() => {
    if (!latest) return [];
    const byAgent = new Map<string, { scores: (number | null)[]; perCase: Map<string, number | null> }>();
    for (const agentId of latest.agentIds) byAgent.set(agentId, { scores: [], perCase: new Map() });
    for (const s of latest.scores) {
      const row = byAgent.get(s.agentId);
      if (row) {
        row.scores.push(s.score);
        row.perCase.set(s.caseId, s.score);
      }
    }
    return [...byAgent.entries()].map(([agentId, row]) => {
      const valid = row.scores.filter((x): x is number => x !== null);
      return {
        agentId,
        avg: valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null,
        perCase: row.perCase,
      };
    });
  }, [latest]);

  const scoreColor = (v: number | null | undefined) =>
    v == null ? "var(--color-ink-faint)" : v >= 8 ? ACCENTS.lime.base : v >= 5 ? ACCENTS.amber.base : ACCENTS.rose.base;

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
      <div className="flex flex-col gap-4">
        <Panel title="Run Evals">
          <div className="flex flex-col gap-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              {candidates.map((c) => {
                const on = selected.includes(c.id);
                const col = ACCENTS[c.accent];
                return (
                  <button
                    key={c.id}
                    onClick={() => c.online && setSelected((p) => (on ? p.filter((x) => x !== c.id) : [...p, c.id]))}
                    disabled={!c.online}
                    aria-pressed={on}
                    className="flex cursor-pointer items-center gap-2 rounded-xl border px-2.5 py-1.5 text-xs font-medium transition-all disabled:cursor-not-allowed disabled:opacity-30"
                    style={{
                      borderColor: on ? col.border : "var(--color-line)",
                      background: on ? col.soft : "transparent",
                      color: on ? col.base : "var(--color-ink-dim)",
                    }}
                  >
                    <Avatar kind={c.kind} name={c.name} accent={c.accent} size={20} />
                    {c.name}
                  </button>
                );
              })}
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={run}
                disabled={selected.length === 0 || starting || running}
                className="ml-auto flex cursor-pointer items-center gap-2 rounded-xl bg-gradient-to-br from-violet-700 to-neon-violet px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-35"
              >
                <IconCheck width={15} height={15} />
                {running ? "Running…" : `Run ${cases.length} cases`}
              </motion.button>
            </div>
            <p className="font-mono text-[10px] text-ink-faint">
              Each agent answers every case; Claude judges 0–10 against the case criteria. Costs ≈ one Claude run per answer.
            </p>
          </div>
        </Panel>

        <Panel title={latest ? `Latest Run · ${new Date(latest.ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}${latest.status === "running" ? " · running" : ""}` : "Latest Run"} delay={0.06}>
          <div className="overflow-x-auto p-4">
            {!latest && <EmptyState accent="violet" title="No report cards" hint="Pick agents and run the suite — scores land here and trend over time." />}
            {latest && (
              <table className="w-full text-left font-mono text-[11px]">
                <thead>
                  <tr className="text-[9.5px] uppercase tracking-[0.12em] text-ink-faint">
                    <th className="pb-2 pr-4">Agent</th>
                    {cases.map((c) => (
                      <th key={c.id} className="pb-2 pr-4" title={c.prompt}>
                        {c.name}
                      </th>
                    ))}
                    <th className="pb-2">Avg</th>
                  </tr>
                </thead>
                <tbody>
                  {latestByAgent.map((row) => (
                    <tr key={row.agentId} className="border-t border-line">
                      <td className="py-2 pr-4 text-ink">{row.agentId}</td>
                      {cases.map((c) => {
                        const v = row.perCase.get(c.id);
                        return (
                          <td key={c.id} className="py-2 pr-4 font-bold" style={{ color: scoreColor(v) }}>
                            {v == null ? (row.perCase.has(c.id) ? "—" : "…") : v.toFixed(0)}
                          </td>
                        );
                      })}
                      <td className="py-2 font-bold" style={{ color: scoreColor(row.avg) }}>
                        {row.avg == null ? "…" : row.avg.toFixed(1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Panel>

        <Panel title="History" delay={0.1}>
          <div className="flex flex-col gap-1.5 p-4">
            {runs.filter((r) => r.status === "done").length === 0 && (
              <p className="py-3 text-center text-xs text-ink-faint">Run the suite weekly and trends appear here.</p>
            )}
            {[...runs]
              .filter((r) => r.status === "done")
              .slice(-8)
              .reverse()
              .map((r) => {
                const valid = r.scores.filter((s) => s.score !== null);
                const avg = valid.length ? valid.reduce((a, s) => a + (s.score ?? 0), 0) / valid.length : 0;
                return (
                  <div key={r.id} className="flex items-center gap-3 rounded-lg border border-line bg-white/[0.02] px-3 py-2 font-mono text-[10.5px]">
                    <span className="text-ink-faint">{new Date(r.ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}</span>
                    <span className="text-ink-dim">{r.agentIds.join(", ")}</span>
                    <span className="ml-auto font-bold" style={{ color: scoreColor(avg) }}>
                      {avg.toFixed(1)}/10
                    </span>
                  </div>
                );
              })}
          </div>
        </Panel>
      </div>

      <div className="flex flex-col gap-4">
        <Panel title="Test Cases" delay={0.05}>
          <div className="flex flex-col gap-2 p-3">
            {cases.map((c) => (
              <div key={c.id} className="rounded-xl border border-line bg-white/[0.02] p-3">
                <div className="flex items-center gap-2">
                  <StatusOrb accent="violet" pulsing={false} size={6} />
                  <p className="min-w-0 flex-1 truncate text-xs font-semibold text-ink">{c.name}</p>
                  <button
                    onClick={() => fetch(`/api/evals?caseId=${c.id}`, { method: "DELETE" }).then(poll)}
                    aria-label={`Delete case ${c.name}`}
                    className="cursor-pointer rounded p-1 text-ink-faint transition-colors hover:text-neon-rose"
                  >
                    <IconTrash width={12} height={12} />
                  </button>
                </div>
                <p className="mt-1 line-clamp-2 font-mono text-[9.5px] leading-4 text-ink-faint">{c.prompt}</p>
              </div>
            ))}

            <div className="mt-1 flex flex-col gap-2 rounded-xl border border-line bg-white/[0.02] p-3">
              <p className="panel-title">Add Case</p>
              <input value={caseName} onChange={(e) => setCaseName(e.target.value)} placeholder="Name" aria-label="Case name" className={inputCls} />
              <textarea value={casePrompt} onChange={(e) => setCasePrompt(e.target.value)} placeholder="Prompt given to the model" aria-label="Case prompt" rows={2} className={`${inputCls} h-auto resize-none py-2`} />
              <textarea value={caseCriteria} onChange={(e) => setCaseCriteria(e.target.value)} placeholder="Scoring criteria for the judge" aria-label="Case criteria" rows={2} className={`${inputCls} h-auto resize-none py-2`} />
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={addNewCase}
                disabled={!caseName.trim() || !casePrompt.trim() || !caseCriteria.trim()}
                className="flex cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-white/5 py-2 text-xs font-semibold text-ink transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-35"
              >
                <IconPlus width={13} height={13} /> Add
              </motion.button>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
