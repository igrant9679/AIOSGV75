"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Panel from "../ui/Panel";
import EmptyState from "../ui/EmptyState";
import Markdown from "../Markdown";
import { ACCENTS, type Accent } from "@/lib/accents";
import type { Run, RunStatus, RunTask, Tier } from "@/lib/runs";
import { toolLabel } from "@/lib/sessionTools";
import { useHub, HubError, Chip, ago } from "./common";
import { SmallButton } from "./SessionPanel";

/**
 * Runs — hand over a project; it is planned into tasks, each task is done by a
 * real session (Claude Code, Codex or Hermes) on the cheapest worker that fits,
 * reviewed, reworked or escalated, and delivered. Engine: lib/runs.ts,
 * API: /api/runs. The page only asks; the machine that started a run advances it.
 */

const STATUS: Record<RunStatus, { label: string; accent: Accent }> = {
  planning: { label: "Planning", accent: "cyan" },
  awaiting_approval: { label: "Needs your approval", accent: "rose" },
  running: { label: "Running", accent: "amber" },
  paused: { label: "Paused", accent: "violet" },
  delivering: { label: "Writing the delivery", accent: "amber" },
  done: { label: "Done", accent: "lime" },
  failed: { label: "Failed", accent: "rose" },
  stopped: { label: "Stopped", accent: "violet" },
};

const TIER: Record<Tier, { label: string; accent: Accent; hint: string }> = {
  routine: { label: "routine", accent: "lime", hint: "Free or cheapest worker: Hermes on a free Nous model" },
  standard: { label: "standard", accent: "amber", hint: "A subscription tool: Codex, else Claude on a smaller model" },
  hard: { label: "hard", accent: "rose", hint: "The strongest worker: Claude" },
};

const TASK_STATE: Record<RunTask["status"], { label: string; accent: Accent }> = {
  pending: { label: "waiting", accent: "cyan" },
  running: { label: "working", accent: "amber" },
  review: { label: "in review", accent: "violet" },
  done: { label: "done", accent: "lime" },
  failed: { label: "failed", accent: "rose" },
};

function Pill({ accent, children, title }: { accent: Accent; children: ReactNode; title?: string }) {
  return (
    <span title={title} className="rounded-md border px-1.5 py-0.5 font-mono text-[10px]" style={{ borderColor: ACCENTS[accent].border, color: ACCENTS[accent].base, background: ACCENTS[accent].soft }}>
      {children}
    </span>
  );
}

async function post(body: object): Promise<{ ok?: boolean; error?: string; run?: Run }> {
  try {
    const res = await fetch("/api/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return (await res.json()) as { ok?: boolean; error?: string; run?: Run };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

function TaskRow({ t }: { t: RunTask }) {
  const [open, setOpen] = useState(false);
  const s = TASK_STATE[t.status];
  const escalated = t.workTier !== t.tier;
  return (
    <div className="rounded-xl border border-line" style={{ borderLeft: `3px solid ${ACCENTS[s.accent].base}` }}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full cursor-pointer flex-wrap items-center gap-2 px-3 py-2 text-left" aria-expanded={open}>
        <span className="font-mono text-[10px] text-ink-faint">{t.id}</span>
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink">{t.title}</span>
        <Pill accent={TIER[t.workTier].accent} title={TIER[t.workTier].hint}>
          {escalated ? `${t.tier} → ${t.workTier}` : t.tier}
        </Pill>
        {t.needsWeb && <Pill accent="cyan" title="This task needs the internet, so its worker gets web search">web</Pill>}
        {t.access === "edit" && <Pill accent="amber" title="This task may create and change files in the folder">edits files</Pill>}
        {t.tool && (
          <span className="font-mono text-[10px] text-ink-dim" title={t.why}>
            {toolLabel(t.tool)}
            {t.model ? ` · ${t.model}` : ""}
          </span>
        )}
        <Pill accent={s.accent}>{t.status === "done" && t.reviewNote ? "done · not reviewed" : s.label}</Pill>
      </button>
      {open && (
        <div className="flex flex-col gap-2 border-t border-line px-3 py-2.5 text-[11.5px] leading-5 text-ink-dim">
          <p className="whitespace-pre-wrap">{t.brief}</p>
          <p>
            <span className="text-ink-faint">Done means: </span>
            {t.accept}
          </p>
          {t.dependsOn.length > 0 && <p className="text-ink-faint">Starts after {t.dependsOn.join(", ")}.</p>}
          {t.why && <p className="text-ink-faint">Worker: {t.why}.</p>}
          {(t.attempts > 0 || t.reviewedBy || t.reviewNote) && (
            <p className="text-ink-faint">
              {t.attempts > 0 ? `${t.attempts} failed attempt${t.attempts === 1 ? "" : "s"} · ` : ""}
              {t.reviewNote ? t.reviewNote : t.reviewedBy ? `reviewed by ${t.reviewedBy}` : ""}
            </p>
          )}
          {t.error && <p style={{ color: ACCENTS.rose.base }}>{t.error}</p>}
          {t.feedback && t.status !== "done" && (
            <p>
              <span className="text-ink-faint">Reviewer: </span>
              {t.feedback}
            </p>
          )}
          {t.result && (
            <div className="max-h-80 overflow-y-auto rounded-lg border border-line p-2.5 text-ink">
              <Markdown>{t.result}</Markdown>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RunCard({ run, host, reload }: { run: Run; host: string; reload: () => void }) {
  const [open, setOpen] = useState(run.status !== "done" && run.status !== "stopped" && run.status !== "failed");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const s = STATUS[run.status];
  const done = run.tasks.filter((t) => t.status === "done").length;
  const act = async (action: string) => {
    setBusy(true);
    setMsg(null);
    const r = await post({ action, id: run.id });
    setBusy(false);
    if (r.error) setMsg(r.error);
    else if (action !== "approve" && action !== "reject") setMsg(run.driver === host ? "Asked. It takes effect within 20 seconds." : `Asked. ${run.driverLabel} picks it up when the vault syncs.`);
    reload();
  };
  const live = ["planning", "awaiting_approval", "running", "delivering"].includes(run.status);
  return (
    <div className="rounded-2xl border border-line" style={{ borderLeft: `3px solid ${ACCENTS[s.accent].base}` }}>
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <button type="button" onClick={() => setOpen((v) => !v)} className="min-w-0 flex-1 cursor-pointer text-left" aria-expanded={open}>
          <p className="truncate text-sm font-semibold text-ink">{run.title}</p>
          <p className="truncate font-mono text-[10px] text-ink-faint">
            {run.hostLabel} · {run.folder === "~" ? "home folder" : run.folder} · {run.allowEdit ? "may edit files" : "answer-only"} · started {ago(run.createdAt)} ago
            {run.driver !== host ? ` · advanced by ${run.driverLabel}` : ""}
          </p>
        </button>
        {run.tasks.length > 0 && (
          <span className="font-mono text-[10px] text-ink-dim">
            {done}/{run.tasks.length} tasks
          </span>
        )}
        <Pill accent={s.accent}>{s.label}</Pill>
      </div>

      {open && (
        <div className="flex flex-col gap-2.5 border-t border-line px-4 py-3">
          <p className="whitespace-pre-wrap text-[11.5px] leading-5 text-ink-dim">{run.brief}</p>
          {run.planNote && <p className="text-[11px] text-ink-faint">{run.planNote}</p>}
          {run.error && <p className="text-[11px]" style={{ color: ACCENTS.rose.base }}>{run.error}</p>}
          {run.status === "planning" && <p className="text-[11px] text-ink-faint">The planner is breaking the brief into tasks. This usually takes under two minutes.</p>}

          {run.tasks.map((t) => (
            <TaskRow key={t.id} t={t} />
          ))}

          {run.status === "awaiting_approval" && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2" style={{ borderColor: ACCENTS.rose.border, background: ACCENTS.rose.soft }}>
              <span className="min-w-0 flex-1 text-[11.5px] text-ink">
                Nothing runs until you approve this plan. Open a task to read what its worker will be told.
              </span>
              <SmallButton accent disabled={busy} onClick={() => void act("approve")}>
                Approve and start
              </SmallButton>
              <SmallButton disabled={busy} onClick={() => void act("reject")}>
                Reject
              </SmallButton>
            </div>
          )}

          {run.delivery && (
            <div className="rounded-xl border border-line p-3">
              <p className="panel-title pb-1.5">Delivery</p>
              <div className="max-h-[28rem] overflow-y-auto text-[12px] leading-5 text-ink">
                <Markdown>{run.delivery}</Markdown>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-1.5">
            {live && run.status !== "awaiting_approval" && (
              <SmallButton disabled={busy} onClick={() => void act("pause")} title="Sessions already running finish; nothing new starts">
                Pause
              </SmallButton>
            )}
            {run.status === "paused" && (
              <SmallButton accent disabled={busy} onClick={() => void act("resume")}>
                Resume
              </SmallButton>
            )}
            {(live || run.status === "paused") && (
              <SmallButton disabled={busy} onClick={() => void act("stop")} title="Stops running sessions and ends the run">
                Stop
              </SmallButton>
            )}
            <span className="font-mono text-[10px] text-ink-faint">In your vault: Agentic OS/Runs/{run.id}</span>
          </div>
          {msg && <p className="text-[11px] text-ink-dim">{msg}</p>}
        </div>
      )}
    </div>
  );
}

export default function RunsSection() {
  const { hub, error: hubError } = useHub(30_000);
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [host, setHost] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/runs");
      const body = (await res.json()) as { runs?: Run[]; host?: string; error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setRuns(body.runs ?? []);
      setHost(body.host ?? "");
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 6_000);
    return () => clearInterval(t);
  }, [load]);

  // where a run can work: a project's folder on a machine that has it, or a machine's home folder
  const places = useMemo(() => {
    const out = new Map<string, { key: string; host: string; hostLabel: string; folder: string; project?: string; label: string }>();
    if (!hub) return [];
    const labelOf = (h: string) => (h === hub.host ? "this machine" : (hub.machines.find((m) => m.host === h)?.label ?? h));
    out.set(`${hub.host}|~`, { key: `${hub.host}|~`, host: hub.host, hostLabel: "this machine", folder: "~", label: "Home folder · this machine" });
    for (const s of hub.sessions) {
      const folder = s.folder || s.cwd;
      if (!folder || s.indexing || s.projectSource === "unsorted") continue;
      const key = `${s.host}|${folder}`;
      if (!out.has(key)) out.set(key, { key, host: s.host, hostLabel: labelOf(s.host), folder, project: s.project, label: `${s.project} · ${labelOf(s.host)}` });
    }
    return [...out.values()].sort((a, b) => Number(b.folder === "~") - Number(a.folder === "~") || a.label.localeCompare(b.label));
  }, [hub]);

  const [brief, setBrief] = useState("");
  const [place, setPlace] = useState("");
  const [planner, setPlanner] = useState<"auto" | "claude" | "hermes" | "codex">("auto");
  const [allowEdit, setAllowEdit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const chosen = places.find((p) => p.key === place) ?? places[0];

  const start = async () => {
    if (brief.trim().length < 12) {
      setMsg({ text: "Describe what you want done first.", ok: false });
      return;
    }
    setBusy(true);
    setMsg(null);
    const r = await post({ action: "create", brief, host: chosen?.host, folder: chosen?.folder, project: chosen?.project, planner, allowEdit });
    setBusy(false);
    if (r.error) setMsg({ text: r.error, ok: false });
    else {
      setBrief("");
      setMsg({ text: "Planning has started. The plan will wait here for your approval.", ok: true });
      load();
    }
  };

  const active = (runs ?? []).filter((r) => !["done", "failed", "stopped"].includes(r.status));
  const finished = (runs ?? []).filter((r) => ["done", "failed", "stopped"].includes(r.status));

  return (
    <div className="flex flex-col gap-4">
      <HubError error={hubError} />
      <Panel title="Start a run">
        <div className="flex flex-col gap-2.5 p-4">
          <textarea
            value={brief}
            onChange={(e) => {
              setBrief(e.target.value);
              if (msg && !msg.ok) setMsg(null);
            }}
            rows={4}
            placeholder="Describe the project: what you want, for whom, and what a good result looks like. It will be planned into tasks, and you approve the plan before anything runs."
            aria-label="Project brief"
            className="w-full resize-y rounded-lg border border-line bg-transparent px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-line-bright"
          />
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 font-mono text-[10px] text-ink-faint">
              Works in
              <select value={chosen?.key ?? ""} onChange={(e) => setPlace(e.target.value)} className="max-w-[22rem] rounded-md border border-line bg-transparent px-1.5 py-1 text-[11px] text-ink">
                {places.map((p) => (
                  <option key={p.key} value={p.key} style={{ background: "var(--color-panel)" }}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <span className="panel-title pl-2 pr-1">Planner</span>
            <Chip active={planner === "auto"} onClick={() => setPlanner("auto")} title="Planning is hard-tier work, so Auto gives it to Claude">
              Auto
            </Chip>
            <Chip active={planner === "claude"} onClick={() => setPlanner("claude")}>
              Claude
            </Chip>
            <Chip active={planner === "hermes"} onClick={() => setPlanner("hermes")} title="Hermes plans on a free Nous model. Cheaper; expect a plainer plan">
              Hermes
            </Chip>
            <Chip active={planner === "codex"} onClick={() => setPlanner("codex")}>
              Codex
            </Chip>
            <label className="flex cursor-pointer items-center gap-1.5 pl-2 font-mono text-[10px] text-ink-dim" title="Off: every task answers in text and changes nothing. On: tasks the plan marks 'edits files' may create and change files in that folder">
              <input type="checkbox" checked={allowEdit} onChange={(e) => setAllowEdit(e.target.checked)} />
              Tasks may edit files there
            </label>
            <button
              type="button"
              onClick={() => void start()}
              disabled={busy || !chosen}
              className="ml-auto cursor-pointer rounded-lg px-4 py-2 font-mono text-[11px] font-bold tracking-wide disabled:cursor-default disabled:opacity-50"
              style={{ background: ACCENTS.violet.soft, color: ACCENTS.violet.base, border: `1px solid ${ACCENTS.violet.border}` }}
            >
              {busy ? "Starting…" : "Plan it"}
            </button>
          </div>
          {msg && (
            <p className="text-[11px]" style={{ color: msg.ok ? ACCENTS.lime.base : ACCENTS.rose.base }}>
              {msg.text}
            </p>
          )}
          <p className="text-[10.5px] leading-4 text-ink-faint">
            Each task goes to the cheapest worker that fits: routine work to Hermes on a free model, standard work to Codex, hard work to Claude. A task that fails review twice is retried one tier up. Review here is a second model reading the output; nothing is executed to check it yet.
          </p>
        </div>
      </Panel>

      {error && (
        <p className="rounded-xl border border-line px-4 py-2 font-mono text-[11px]" style={{ color: ACCENTS.rose.base }}>
          Couldn&apos;t load runs: {error}
        </p>
      )}

      <Panel title={`In progress${active.length ? ` · ${active.length}` : ""}`}>
        <div className="flex flex-col gap-2.5 p-4">
          {runs && active.length === 0 && <EmptyState compact accent="violet" title="No runs in progress" hint="Describe a project above. You approve the plan before any worker starts." />}
          {active.map((r) => (
            <RunCard key={r.id} run={r} host={host} reload={load} />
          ))}
        </div>
      </Panel>

      {finished.length > 0 && (
        <Panel title={`Finished · ${finished.length}`}>
          <div className="flex flex-col gap-2.5 p-4">
            {finished.slice(0, 20).map((r) => (
              <RunCard key={r.id} run={r} host={host} reload={load} />
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}
