"use client";

import Link from "next/link";
import { useProductName } from "../useNetSettings";
import { useCallback, useEffect, useMemo, useState } from "react";
import Panel from "../ui/Panel";
import EmptyState from "../ui/EmptyState";
import { ACCENTS } from "@/lib/accents";
import type { LiveSession } from "@/lib/sessionLive";
import type { EventsView, NeedsItem } from "@/lib/sessionEvents";
import type { Candidate } from "@/lib/dispatch";
import type { HubSnapshot } from "@/lib/activity";
import { ago, fmtTokens, SourcePill } from "./common";
import { JobBubble, SmallButton, sessionsPost, useSessionJobs } from "./SessionPanel";

/**
 * Command page panels for running the whole machine group from one place:
 *   LiveSessionsPanel  what every open session on every machine is doing (+ Stop)
 *   useSessionAlerts   session events → "Needs you" items
 *   RunSomewherePanel  send a task to whichever machine is free
 */

const dur = (ms: number) => {
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "<1 min";
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
};

export const sessionHref = (key: string) => `/projects?session=${encodeURIComponent(key)}`;

function usePoll<T>(url: string, ms: number): { data: T | null; error: string | null; reload: () => Promise<void> } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      const r = await fetch(url);
      const b = (await r.json()) as T & { error?: string };
      if (r.ok) {
        setData(b);
        setError(null);
      } else setError(b.error ?? `HTTP ${r.status}`);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [url]);
  useEffect(() => {
    reload();
    const t = setInterval(reload, ms);
    return () => clearInterval(t);
  }, [reload, ms]);
  return { data, error, reload };
}

// ─── live sessions ───

function StopButton({ l, onDone }: { l: LiveSession; onDone: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const stop = async () => {
    setMsg("Stopping…");
    const r = await sessionsPost({ action: "stop", key: l.key });
    setMsg(r.error ?? r.job?.reply ?? (r.job?.status === "sent" ? `Sent to ${l.hostLabel} - it stops when that machine picks it up.` : "Stopped."));
    setConfirm(false);
    onDone();
  };
  if (msg) return <span className="font-mono text-[10px] text-ink-faint">{msg}</span>;
  if (confirm) {
    return (
      <span className="flex flex-wrap items-center gap-1.5 font-mono text-[10px]" style={{ color: ACCENTS.rose.base }}>
        {l.interactive ? `Open in ${l.tool === "claude" ? "the Claude app / a terminal" : "Codex"} on ${l.hostLabel} - stopping ends it there.` : "Stop this run?"}
        <SmallButton onClick={stop}>Stop it</SmallButton>
        <SmallButton onClick={() => setConfirm(false)}>Cancel</SmallButton>
      </span>
    );
  }
  return (
    <SmallButton onClick={() => (l.interactive ? setConfirm(true) : stop())} title={l.interactive ? "Asks first: this session is open in an app or terminal" : "Stop this background run"}>
      Stop
    </SmallButton>
  );
}

export function LiveSessionsPanel() {
  const { data, error, reload } = usePoll<{ live: LiveSession[]; machines: { host: string; label: string; via: string; at: number }[] }>("/api/hub/live", 10_000);
  const live = data?.live ?? [];
  const now = Date.now();
  return (
    <Panel
      title={`Live sessions · ${live.length}`}
      right={
        <span className="font-mono text-[10px] text-ink-faint" title="How each machine's live state reaches this one">
          {data?.machines.map((m) => `${m.label} ${m.via === "self" ? "(here)" : m.via === "lan" ? "· LAN" : "· OneDrive"}`).join(" · ")}
        </span>
      }
    >
      <div className="grid gap-2 p-4 lg:grid-cols-2">
        {error && <p className="text-[11px] text-ink-faint">{error}</p>}
        {data && live.length === 0 && (
          <div className="lg:col-span-2">
            <EmptyState accent="cyan" title="No open sessions" hint="Sessions open in the Claude app, a terminal or Codex on any machine show up here, with what they're doing right now." compact />
          </div>
        )}
        {live.map((l) => {
          const warn = l.status === "waiting" ? ACCENTS.amber : l.stuck || l.looping ? ACCENTS.rose : l.status === "running" ? ACCENTS.cyan : null;
          return (
            <div key={`${l.host}|${l.key}`} className="flex flex-col gap-1.5 rounded-xl border border-line px-3 py-2.5" style={warn ? { borderLeft: `3px solid ${warn.base}` } : undefined}>
              <div className="flex items-start gap-2">
                <span className="min-w-0 flex-1">
                  <Link href={sessionHref(l.key)} className="block truncate text-xs font-semibold text-ink hover:underline">
                    {l.title}
                  </Link>
                  <span className="block truncate font-mono text-[10px] text-ink-faint">
                    {l.hostLabel} · {l.project}
                    {l.since ? ` · this turn ${dur(now - l.since)}` : ""}
                    {l.turnTokens ? ` · ${fmtTokens(l.turnTokens)} tokens` : ""} · active {ago(l.lastActivity)} ago
                  </span>
                </span>
                <SourcePill source={l.tool} />
              </div>
              <p className="truncate font-mono text-[10.5px]" style={{ color: warn?.base ?? "var(--color-ink-dim)" }} title={l.step}>
                {l.step}
              </p>
              {(l.stuck || l.looping) && (
                <p className="text-[11px] font-semibold" style={{ color: ACCENTS.rose.base }}>
                  ⚠ {l.stuck ? `Stuck? ${l.stuck}.` : ""} {l.looping ? `Looping? ${l.looping}.` : ""}
                </p>
              )}
              {l.lastText && <p className="line-clamp-2 text-[11px] leading-4 text-ink-faint">{l.lastText}</p>}
              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                <Link href={sessionHref(l.key)} className="rounded-md border border-line px-2 py-1 font-mono text-[10px] text-ink-dim hover:bg-white/[0.06]">
                  Open
                </Link>
                {l.status !== "idle" && <StopButton l={l} onDone={reload} />}
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

// ─── session alerts → Needs you ───

export interface AlertItem {
  key: string;
  label: string;
  detail: string;
  ts: number;
  href: string;
  accent: "amber" | "lime";
  eventIds: string[];
}

export function useSessionAlerts(): { items: AlertItem[]; dismiss: (ids: string[]) => Promise<void> } {
  const { data, reload } = usePoll<EventsView>("/api/hub/events", 15_000);
  const items = useMemo<AlertItem[]>(
    () =>
      (data?.needs ?? []).map((n: NeedsItem) => ({
        key: n.id,
        label:
          n.reason === "waiting"
            ? `${n.hostLabel} · ${n.title} is waiting for you`
            : `${n.hostLabel} · ${n.title} finished after ${dur(n.turnMs ?? 0)}${n.filesChanged ? `, ${n.filesChanged} files changed` : ""}`,
        detail: n.message || (n.reason === "waiting" ? "Needs your answer" : "Done"),
        ts: n.ts,
        href: sessionHref(n.key),
        accent: n.reason === "waiting" ? "amber" : "lime",
        eventIds: [n.id],
      })),
    [data],
  );
  const dismiss = async (ids: string[]) => {
    await fetch("/api/hub/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "dismiss", ids }) });
    await reload();
  };
  return { items, dismiss };
}

// ─── run somewhere ───

export function RunSomewherePanel({ hub }: { hub: HubSnapshot | null }) {
  const product = useProductName(); // this network's product name
  const [prompt, setPrompt] = useState("");
  const [project, setProject] = useState("");
  const [tool, setTool] = useState<"claude" | "codex">("claude");
  const [access, setAccess] = useState<"answer" | "edit">("answer");
  const [ranked, setRanked] = useState<Candidate[] | null>(null);
  const [pick, setPick] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { jobs, reloadJobs } = useSessionJobs();

  const projects = useMemo(() => {
    const set = new Set<string>();
    for (const s of hub?.sessions ?? []) if (s.folder && s.project !== "Unsorted" && !s.hidden) set.add(s.project);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [hub]);

  useEffect(() => {
    let live = true;
    setRanked(null);
    fetch(`/api/hub/dispatch?tool=${tool}${project ? `&project=${encodeURIComponent(project)}` : ""}`)
      .then((r) => r.json())
      .then((b: { candidates?: Candidate[] }) => {
        if (!live) return;
        setRanked(b.candidates ?? []);
        setPick(b.candidates?.find((c) => c.ok)?.host ?? "");
      })
      .catch(() => live && setRanked([]));
    return () => {
      live = false;
    };
  }, [tool, project]);

  const chosen = ranked?.find((c) => c.host === pick);
  const run = async () => {
    if (!chosen || !prompt.trim()) return;
    setBusy(true);
    setErr(null);
    const r = await sessionsPost({
      action: "new",
      host: chosen.host,
      folder: chosen.folder ?? "~",
      tool,
      project: project || undefined,
      prompt: prompt.trim(),
      access,
      dispatch: `${chosen.label}: ${chosen.reasons.join(", ")}`,
    });
    setBusy(false);
    if (r.error) setErr(r.error);
    else {
      setPrompt("");
      reloadJobs();
    }
  };
  const mine = jobs.filter((j) => j.dispatch && !j.requestedBy).slice(0, 4);

  return (
    <Panel title="Run somewhere">
      <div className="flex flex-col gap-3 p-4">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              run();
            }
          }}
          rows={3}
          placeholder={`Describe a task - ${product} picks the machine that's free, has the project, and has room on its subscription.`}
          aria-label="Task"
          className="min-h-[70px] w-full resize-y rounded-lg border border-line bg-transparent px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-line-bright"
        />
        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] text-ink-dim">
          <select value={project} onChange={(e) => setProject(e.target.value)} aria-label="Project" className="max-w-[220px] rounded-md border border-line bg-transparent px-1.5 py-1 text-[10px] text-ink">
            <option value="" style={{ background: "var(--color-panel)" }}>
              No project (home folder)
            </option>
            {projects.map((p) => (
              <option key={p} value={p} style={{ background: "var(--color-panel)" }}>
                {p}
              </option>
            ))}
          </select>
          <select value={tool} onChange={(e) => setTool(e.target.value as "claude" | "codex")} aria-label="Tool" className="rounded-md border border-line bg-transparent px-1.5 py-1 text-[10px] text-ink">
            <option value="claude" style={{ background: "var(--color-panel)" }}>
              Claude Code
            </option>
            <option value="codex" style={{ background: "var(--color-panel)" }}>
              Codex
            </option>
          </select>
          <select value={access} onChange={(e) => setAccess(e.target.value as "answer" | "edit")} aria-label="What it may do" className="rounded-md border border-line bg-transparent px-1.5 py-1 text-[10px] text-ink">
            <option value="answer" style={{ background: "var(--color-panel)" }}>
              Answer only
            </option>
            <option value="edit" style={{ background: "var(--color-panel)" }}>
              Can edit files
            </option>
          </select>
          <span className="flex-1" />
          <button
            type="button"
            onClick={run}
            disabled={busy || !chosen?.ok || !prompt.trim()}
            className="cursor-pointer rounded-md border px-3 py-1 font-mono text-[11px] font-semibold transition-colors hover:bg-white/[0.06] disabled:cursor-default disabled:opacity-40"
            style={{ borderColor: "var(--page-accent)", color: "var(--page-accent)" }}
          >
            {busy ? "Sending…" : chosen ? `Run on ${chosen.label}` : "Run"}
          </button>
        </div>
        <div className="flex flex-col gap-1">
          {ranked === null && <p className="font-mono text-[10px] text-ink-faint">Checking machines…</p>}
          {ranked?.map((c) => (
            <label key={c.host} className={`flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1 text-[11px] ${c.ok ? "" : "opacity-50"}`} style={pick === c.host ? { background: "color-mix(in srgb, var(--page-accent) 10%, transparent)" } : undefined}>
              <input type="radio" name="run-somewhere" disabled={!c.ok} checked={pick === c.host} onChange={() => setPick(c.host)} className="mt-0.5" />
              <span className="min-w-0">
                <span className="font-semibold text-ink">{c.label}</span>
                <span className="text-ink-faint"> · {c.ok ? c.reasons.join(" · ") : c.blocked}</span>
              </span>
            </label>
          ))}
        </div>
        {err && (
          <p className="text-[11px]" style={{ color: ACCENTS.rose.base }}>
            {err}
          </p>
        )}
        {mine.map((j) => (
          <JobBubble key={j.id} job={j} onOpenSession={(k) => (window.location.href = sessionHref(k))} knownKeys={new Set(hub?.sessions.map((s) => s.key))} />
        ))}
      </div>
    </Panel>
  );
}
