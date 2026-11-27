"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Panel from "../ui/Panel";
import Markdown from "../Markdown";
import { ACCENTS, type Accent } from "@/lib/accents";
import type { Assignee, Place, RepoTask, TaskStatus, WorkSettings } from "@/lib/repoTasks";
import { Chip, ago } from "./common";
import { SmallButton } from "./SessionPanel";

interface View {
  tasks: RepoTask[];
  settings: WorkSettings;
  places: Record<string, Place[]>;
  teammates: { id: string; name: string; host: string; folder: string }[];
  levelup?: {
    connected: boolean;
    url: string | null;
    connectedAt: number | null;
    status: { ok: boolean; at: number; error?: string; items?: number; open?: number; outboxAt?: number; outboxCount?: number } | null;
    areas: { names: string[]; clients: string[]; repos: Record<string, string>; folders: Record<string, { host: string; hostLabel: string; folder: string; tool: string; agent?: string; agentLabel?: string }> };
    repoAreas: Record<string, string | null>;
  };
  error?: string;
}

const COLUMNS: { status: TaskStatus; label: string; accent: Accent; hint: string }[] = [
  { status: "inbox", label: "Inbox", accent: "cyan", hint: "new from your repositories, not assigned yet" },
  { status: "todo", label: "To do", accent: "violet", hint: "assigned, not started" },
  { status: "doing", label: "In progress", accent: "amber", hint: "an AI in the fleet is on it" },
  { status: "review", label: "Review", accent: "magenta", hint: "finished by the fleet: check the result" },
  { status: "done", label: "Done", accent: "lime", hint: "" },
];
const PRIORITY_COLOR: Record<number, string> = { 1: ACCENTS.rose.base, 2: ACCENTS.amber.base, 3: ACCENTS.cyan.base };

const post = async (body: object): Promise<Record<string, unknown> & { error?: string }> => {
  try {
    const r = await fetch("/api/work", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return await r.json();
  } catch (e) {
    return { error: (e as Error).message };
  }
};

const assigneeText = (a: Assignee) => (a.kind === "me" ? "You" : a.kind === "teammate" ? a.name : a.kind === "machine" ? `${a.hostLabel} · ${a.agentLabel ?? (a.tool === "claude" ? "Claude Code" : a.tool === "codex" ? "Codex" : a.tool)}` : "Nobody");
const assigneeValue = (a: Assignee, places: Place[]): string => {
  if (a.kind === "me" || a.kind === "none") return a.kind;
  if (a.kind === "teammate") return `teammate:${a.id}`;
  const p = places.find((x) => x.kind === "machine" && x.host === a.host && x.tool === a.tool && (x.agent ?? "") === (a.agent ?? "") && x.folder === a.folder);
  return p ? `place:${p.key}` : "custom";
};

/**
 * /work: the tasks your repositories mention (lib/repoTasks.ts), assigned to you or to the fleet,
 * started from here and followed until they're done.
 */
export default function WorkSection() {
  const [view, setView] = useState<View | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [mode, setMode] = useState<"board" | "projects">("board");
  const [repo, setRepo] = useState("");
  const [who, setWho] = useState<"" | "me" | "fleet" | "none">("");
  const [source, setSource] = useState("");
  const [q, setQ] = useState("");
  const [showClosed, setShowClosed] = useState(false);
  const [area, setArea] = useState("");

  const load = useCallback(() => {
    fetch("/api/work")
      .then((r) => r.json())
      .then((b: View) => (b.error ? setMsg({ text: b.error, bad: true }) : setView(b)))
      .catch((e: Error) => setMsg({ text: e.message, bad: true }));
  }, []);
  const doing = view?.tasks.some((t) => t.status === "doing");
  useEffect(() => {
    load();
    const t = setInterval(load, doing ? 5_000 : 30_000);
    return () => clearInterval(t);
  }, [load, doing]);

  const act = async (name: string, body: object, done: (r: Record<string, unknown>) => string) => {
    setBusy(name);
    setMsg(null);
    const r = await post(body);
    setBusy(null);
    setMsg(r.error ? { text: r.error, bad: true } : { text: done(r) });
    load();
  };

  const tasks = view?.tasks ?? [];
  const repos = useMemo(() => [...new Set(tasks.map((t) => t.repo))].sort(), [tasks]);
  const repoAreas = view?.levelup?.repoAreas;
  const areaOf = useCallback((t: RepoTask) => (t.area ?? repoAreas?.[t.repo] ?? "").replace(/ · .*$/, ""), [repoAreas]);
  const areas = useMemo(() => [...new Set(tasks.map(areaOf).filter(Boolean))].sort(), [tasks, areaOf]);
  const allPlaces = useMemo(() => {
    const m = new Map<string, Place>();
    for (const list of Object.values(view?.places ?? {})) for (const p of list) if (!m.has(p.key)) m.set(p.key, p);
    return [...m.values()];
  }, [view]);
  const placesFor = (t: RepoTask) => (t.origin ? allPlaces : (view?.places[t.repo.toLowerCase()] ?? []));
  const shown = tasks.filter((t) => {
    if (!showClosed && t.status === "dismissed") return false;
    if (repo && t.repo !== repo) return false;
    if (who === "me" && t.assignee.kind !== "me") return false;
    if (who === "fleet" && t.assignee.kind !== "machine" && t.assignee.kind !== "teammate") return false;
    if (who === "none" && t.assignee.kind !== "none") return false;
    if (source && t.source.kind !== source) return false;
    if (area && areaOf(t) !== area) return false;
    if (q && !`${t.title} ${t.repo} ${t.source.label} ${t.notes ?? ""}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });
  const open = tasks.filter((t) => !["done", "dismissed"].includes(t.status));
  const count = (f: (t: RepoTask) => boolean) => open.filter(f).length;

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Work" right={<span className="font-mono text-[10px] text-ink-faint">{open.length} open across {new Set(open.map((t) => t.repo)).size} projects</span>}>
        <div className="flex flex-col gap-3 p-4">
          <p className="text-[11px] leading-4 text-ink-faint">
            Every task your repositories mention (to-do lists, next steps, “waiting on you” sections, open issues) plus what GitHub says needs you, in one place. Assign each to yourself, a Team teammate, or a machine and tool in the fleet that has the project&apos;s folder, or let Mission Control assign them. <b>Start</b> hands a task to its AI and follows it here.
          </p>
          <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] text-ink-dim">
            <span>
              yours <b className="text-ink">{count((t) => t.assignee.kind === "me")}</b>
            </span>
            <span>
              fleet <b className="text-ink">{count((t) => t.assignee.kind === "machine" || t.assignee.kind === "teammate")}</b>
            </span>
            <span>
              unassigned <b className="text-ink">{count((t) => t.assignee.kind === "none")}</b>
            </span>
            <span>
              in progress <b className="text-ink">{count((t) => t.status === "doing")}</b>
            </span>
            <span>
              to review <b style={{ color: ACCENTS.magenta.base }}>{count((t) => t.status === "review")}</b>
            </span>
            <span className="flex-1" />
            <SmallButton onClick={() => void act("sync", { action: "sync" }, (r) => `From the latest GitHub report: ${r.added} new, ${r.updated} updated, ${r.gone} no longer in their source, ${r.closed} closed.`)} disabled={!!busy} title="Bring in the tasks from the latest GitHub report (it also happens after every report)">
              {busy === "sync" ? "Syncing…" : "Sync from GitHub"}
            </SmallButton>
            <SmallButton onClick={() => void act("auto", { action: "auto-assign" }, (r) => `Assigned ${r.me} to you and ${r.ai} to the fleet${r.nobody ? `; ${r.nobody} have nowhere to go (no machine has that repository)` : ""}.`)} disabled={!!busy} title="Mission Control assigns every unassigned task by rules">
              {busy === "auto" ? "Assigning…" : "Assign for me"}
            </SmallButton>
            <SmallButton onClick={() => void act("smart", { action: "smart-assign" }, (r) => (r.error ? `Claude couldn't help: ${r.error}` : `Claude looked at ${r.asked} tasks and changed ${r.changed} assignments.`))} disabled={!!busy} title="Ask Claude (no tools) who should do the unclear ones, how hard they are and whether files must change">
              {busy === "smart" ? "Asking Claude…" : "Smart assign"}
            </SmallButton>
            <SmallButton accent onClick={() => void act("all", { action: "start-all" }, (r) => `Started ${r.started}.${(r.failed as string[])?.length ? ` Couldn't start: ${(r.failed as string[]).join("; ")}` : ""}`)} disabled={!!busy} title="Start every task assigned to a machine or teammate that isn't started yet">
              {busy === "all" ? "Starting…" : "Start all assigned"}
            </SmallButton>
          </div>
          {view && (
            <div className="flex flex-wrap items-center gap-3 font-mono text-[10px] text-ink-dim">
              <label className="flex cursor-pointer items-center gap-1">
                <input type="checkbox" checked={view.settings.autoAssign} onChange={(e) => void act("set", { action: "settings", autoAssign: e.target.checked }, () => "Saved.")} /> assign new tasks automatically after each GitHub report
              </label>
              <label className="flex cursor-pointer items-center gap-1" title="Starts one assigned task at a time (two at most running), never while the fleet is paused. Answer-only unless a task is set to allow edits.">
                <input type="checkbox" checked={view.settings.autoStart} onChange={(e) => void act("set", { action: "settings", autoStart: e.target.checked }, () => "Saved.")} /> start assigned tasks automatically
              </label>
            </div>
          )}
          {msg && (
            <p className="text-[11px]" style={{ color: msg.bad ? ACCENTS.rose.base : ACCENTS.lime.base }}>
              {msg.text}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip active={mode === "board"} onClick={() => setMode("board")}>
              board
            </Chip>
            <Chip active={mode === "projects"} onClick={() => setMode("projects")}>
              by project
            </Chip>
            <span className="w-2" />
            <select value={repo} onChange={(e) => setRepo(e.target.value)} aria-label="Project" className="rounded-md border border-line bg-transparent px-1.5 py-1 font-mono text-[10px] text-ink">
              <option value="" style={{ background: "var(--color-panel)" }}>every project</option>
              {repos.map((r) => (
                <option key={r} value={r} style={{ background: "var(--color-panel)" }}>
                  {r}
                </option>
              ))}
            </select>
            {(["", "me", "fleet", "none"] as const).map((w) => (
              <Chip key={w || "all"} active={who === w} onClick={() => setWho(w)}>
                {w === "" ? "anyone" : w === "me" ? "mine" : w === "fleet" ? "the fleet's" : "unassigned"}
              </Chip>
            ))}
            {(["", "doc", "issue", "github", "levelup"] as const).map((s) => (
              <Chip key={s || "any"} active={source === s} onClick={() => setSource(s)}>
                {s === "" ? "any source" : s === "doc" ? "documents" : s === "issue" ? "issues" : s === "github" ? "GitHub signals" : "LevelUp"}
              </Chip>
            ))}
            {areas.length > 0 && (
              <select value={area} onChange={(e) => setArea(e.target.value)} aria-label="Area" className="rounded-md border border-line bg-transparent px-1.5 py-1 font-mono text-[10px] text-ink">
                <option value="" style={{ background: "var(--color-panel)" }}>every area</option>
                {areas.map((a) => (
                  <option key={a} value={a} style={{ background: "var(--color-panel)" }}>
                    {a}
                  </option>
                ))}
              </select>
            )}
            <label className="flex cursor-pointer items-center gap-1 font-mono text-[10px] text-ink-dim">
              <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> show dismissed
            </label>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="search tasks" aria-label="Search tasks" className="ml-auto rounded-md border border-line bg-transparent px-2 py-1 font-mono text-[10px] text-ink outline-none" />
          </div>
          {view && !tasks.length && <p className="text-[12px] text-ink-faint">No tasks yet. Make a GitHub report (GitHub → Refresh); its tasks come in here, or press Sync from GitHub.</p>}
        </div>
      </Panel>

      {view?.levelup && <LevelupPanel lu={view.levelup} places={view.places} act={act} busy={busy} />}

      {view && mode === "board" && (
        <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-5">
          {[...COLUMNS, ...(showClosed ? [{ status: "dismissed" as TaskStatus, label: "Dismissed", accent: "cyan" as Accent, hint: "" }] : [])].map((c) => {
            const list = shown.filter((t) => t.status === c.status).sort((a, b) => a.priority - b.priority || b.updatedAt - a.updatedAt);
            return (
              <Panel key={c.status} title={`${c.label} · ${list.length}`}>
                <div className="flex max-h-[75vh] flex-col gap-2 overflow-y-auto p-3">
                  {c.hint && <p className="font-mono text-[9px] text-ink-faint">{c.hint}</p>}
                  {list.slice(0, 150).map((t) => (
                    <TaskCard key={t.id} t={t} places={placesFor(t)} act={act} busy={busy} area={areaOf(t)} />
                  ))}
                  {list.length > 150 && <p className="font-mono text-[10px] text-ink-faint">+ {list.length - 150} more: narrow it with the filters</p>}
                </div>
              </Panel>
            );
          })}
        </div>
      )}

      {view && mode === "projects" && <ByProject tasks={shown} places={view.places} allPlaces={allPlaces} act={act} busy={busy} />}
    </div>
  );
}

type Act = (name: string, body: object, done: (r: Record<string, unknown>) => string) => Promise<void>;

function ByProject({ tasks, places, allPlaces, act, busy }: { tasks: RepoTask[]; places: Record<string, Place[]>; allPlaces: Place[]; act: Act; busy: string | null }) {
  const [open, setOpen] = useState<string | null>(null);
  const groups = [...new Set(tasks.map((t) => t.repo))].map((repo) => ({ repo, list: tasks.filter((t) => t.repo === repo) }));
  groups.sort((a, b) => b.list.filter((t) => !["done", "dismissed"].includes(t.status)).length - a.list.filter((t) => !["done", "dismissed"].includes(t.status)).length);
  return (
    <Panel title="By project">
      <div className="flex flex-col gap-2 p-4">
        {groups.map(({ repo, list }) => {
          const o = list.filter((t) => !["done", "dismissed"].includes(t.status));
          const where = places[repo.toLowerCase()] ?? [];
          return (
            <div key={repo} className="rounded-xl border border-line">
              <button type="button" onClick={() => setOpen(open === repo ? null : repo)} className="flex w-full cursor-pointer flex-wrap items-center gap-3 px-3 py-2 text-left">
                <span className="text-[13px] font-semibold text-ink">{repo}</span>
                <span className="font-mono text-[10px] text-ink-dim">
                  {o.length} open · yours {o.filter((t) => t.assignee.kind === "me").length} · fleet {o.filter((t) => t.assignee.kind === "machine" || t.assignee.kind === "teammate").length} · in progress {o.filter((t) => t.status === "doing").length} · review {o.filter((t) => t.status === "review").length} · done {list.filter((t) => t.status === "done").length}
                </span>
                <span className="flex-1" />
                <span className="font-mono text-[10px] text-ink-faint">{where.length ? `in the fleet: ${[...new Set(where.map((p) => p.hostLabel))].join(", ")}` : "no machine has its folder"}</span>
              </button>
              {open === repo && (
                <div className="grid gap-2 border-t border-line p-3 lg:grid-cols-2">
                  {list
                    .sort((a, b) => COLUMNS.findIndex((c) => c.status === a.status) - COLUMNS.findIndex((c) => c.status === b.status) || a.priority - b.priority)
                    .map((t) => (
                      <TaskCard key={t.id} t={t} places={t.origin ? allPlaces : where} act={act} busy={busy} showStatus area={t.area ?? undefined} />
                    ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function TaskCard({ t, places, act, busy, showStatus, area }: { t: RepoTask; places: Place[]; act: Act; busy: string | null; showStatus?: boolean; area?: string }) {
  const lu = t.origin?.kind === "levelup";
  const waiting = lu && t.approval !== "approved" && ["inbox", "todo"].includes(t.status);
  const [more, setMore] = useState(false);
  const [notes, setNotes] = useState(t.notes ?? "");
  const fleet = t.assignee.kind === "machine" || t.assignee.kind === "teammate";
  const value = assigneeValue(t.assignee, places);
  const setAssignee = (v: string) => {
    let a: Assignee = { kind: "none" };
    if (v === "me") a = { kind: "me" };
    else if (v.startsWith("place:")) {
      const p = places.find((x) => x.key === v.slice(6));
      if (!p) return;
      a = p.kind === "teammate" ? { kind: "teammate", id: p.teammateId!, name: p.label.replace(/ \(teammate\)$/, "") } : { kind: "machine", host: p.host, hostLabel: p.hostLabel, tool: p.tool!, agent: p.agent, agentLabel: p.agentLabel, folder: p.folder };
    }
    void act(`a-${t.id}`, { action: "update", id: t.id, assignee: a }, () => `Assigned to ${assigneeText(a)}.`);
  };
  const status = (s: TaskStatus, label: string) => void act(`s-${t.id}`, { action: "update", id: t.id, status: s }, () => label);
  const place = places.find((p) => `place:${p.key}` === value);
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-line p-2.5">
      <div className="flex items-start gap-2">
        <span className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: PRIORITY_COLOR[t.priority] }} title={t.priority === 1 ? "do soon" : t.priority === 2 ? "this week" : "when you can"} />
        <p className="min-w-0 flex-1 text-[12px] leading-5 text-ink">{t.title}</p>
      </div>
      <p className="font-mono text-[10px] leading-4 text-ink-faint">
        {area && <span style={{ color: ACCENTS.cyan.base }}>{t.area ?? area} · </span>}
        {!lu && (
          <>
            <span style={{ color: ACCENTS.violet.base }}>{t.repo.replace(/^igrant9679\//, "")}</span> ·{" "}
          </>
        )}
        {t.source.url ? (
          <a href={t.source.url} target="_blank" rel="noreferrer" className="hover:underline">
            {t.source.label}
          </a>
        ) : (
          t.source.label
        )}
        {showStatus ? ` · ${COLUMNS.find((c) => c.status === t.status)?.label ?? t.status}` : ""}
        {t.goneFromSource && <span style={{ color: ACCENTS.amber.base }}> · no longer in its source: done there?</span>}
        {lu && t.when && t.status === "todo" && <span> · starts {t.when}</span>}
      </p>
      {waiting && (
        <div className="flex flex-wrap items-center gap-2 rounded-md px-2 py-1.5" style={{ background: "color-mix(in srgb, var(--ac-amber) 8%, transparent)" }}>
          <span className="flex-1 text-[11px]" style={{ color: ACCENTS.amber.base }}>
            Waiting for your approval (here or in LevelUp){t.luProposed ? `: ${t.luProposed}${t.assignee.kind === "machine" && t.assignee.folder === "~" ? " in the home folder" : ""}, ${t.access === "edit" ? "may change files" : "answer only"}` : ""}. Change who does it below before approving if you like.
          </span>
          <SmallButton accent onClick={() => void act(`ap-${t.id}`, { action: "approve", id: t.id }, () => "Approved: it starts within a minute (or on its day).")} disabled={busy === `ap-${t.id}`}>
            Approve
          </SmallButton>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <select value={value} onChange={(e) => setAssignee(e.target.value)} disabled={t.status === "doing"} aria-label="Who does it" className="max-w-[230px] rounded-md border border-line bg-transparent px-1.5 py-0.5 font-mono text-[10px] text-ink">
          <option value="none" style={{ background: "var(--color-panel)" }}>Nobody yet</option>
          <option value="me" style={{ background: "var(--color-panel)" }}>You</option>
          {value === "custom" && <option value="custom" style={{ background: "var(--color-panel)" }}>{assigneeText(t.assignee)}</option>}
          {places.map((p) => (
            <option key={p.key} value={`place:${p.key}`} style={{ background: "var(--color-panel)" }}>
              {p.label}
            </option>
          ))}
        </select>
        {fleet && (
          <select value={t.access} onChange={(e) => void act(`x-${t.id}`, { action: "update", id: t.id, access: e.target.value }, () => "Saved.")} disabled={t.status === "doing"} aria-label="What it may do" className="rounded-md border border-line bg-transparent px-1.5 py-0.5 font-mono text-[10px] text-ink">
            <option value="answer" style={{ background: "var(--color-panel)" }}>answer only</option>
            <option value="edit" disabled={place ? !place.edit : false} style={{ background: "var(--color-panel)" }}>
              may edit files{place && !place.edit ? " (not allowed there)" : ""}
            </option>
          </select>
        )}
        {t.assignedBy && t.assignedBy !== "you" && <span className="font-mono text-[9px] text-ink-faint" title={t.assignReason}>{t.assignedBy === "smart" ? "Claude's pick" : "auto"}</span>}
        <span className="flex-1" />
        {fleet && !lu && ["inbox", "todo", "review"].includes(t.status) && (
          <SmallButton accent onClick={() => void act(`st-${t.id}`, { action: "start", id: t.id }, () => `Started with ${assigneeText(t.assignee)}.`)} disabled={busy === `st-${t.id}`} title={`Send it to ${assigneeText(t.assignee)} with its context`}>
            {t.status === "review" ? "Again" : "Start"}
          </SmallButton>
        )}
        {t.status === "doing" && (
          <span className="flex items-center gap-1 font-mono text-[10px]" style={{ color: ACCENTS.amber.base }}>
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: ACCENTS.amber.base }} /> {assigneeText(t.assignee)} on it{t.job ? ` · ${ago(t.job.startedAt)}` : ""}
          </span>
        )}
        {t.status !== "done" && t.status !== "doing" && (
          <SmallButton onClick={() => status("done", "Marked done.")} title="Mark done">
            Done
          </SmallButton>
        )}
        {lu ? null : t.status === "done" || t.status === "dismissed" ? (
          <SmallButton onClick={() => status("todo", "Back in To do.")} title="Reopen">
            Reopen
          </SmallButton>
        ) : t.status !== "doing" ? (
          <SmallButton onClick={() => status("dismissed", "Dismissed (it won't come back while its source is unchanged).")} title="Not a real task, or not for now">
            ✕
          </SmallButton>
        ) : null}
        <button type="button" onClick={() => setMore(!more)} className="cursor-pointer font-mono text-[10px] text-ink-faint underline">
          {more ? "less" : "more"}
        </button>
      </div>
      {t.result && (t.status === "review" || more) && (
        <div className="rounded-md px-2 py-1.5" style={{ background: "color-mix(in srgb, var(--ac-magenta) 6%, transparent)" }}>
          {t.result.error ? (
            <p className="text-[11px]" style={{ color: ACCENTS.rose.base }}>
              Didn&apos;t finish: {t.result.error}
            </p>
          ) : (
            <div className="max-h-56 overflow-y-auto text-[11.5px]">
              <Markdown>{t.result.text || "(no text reply)"}</Markdown>
            </div>
          )}
          {t.result.key && (
            <a href={`/projects?session=${encodeURIComponent(t.result.key)}`} className="font-mono text-[10px] underline" style={{ color: ACCENTS.magenta.base }}>
              open the session
            </a>
          )}
        </div>
      )}
      {more && (
        <div className="flex flex-col gap-1.5">
          {t.assignReason && <p className="font-mono text-[10px] text-ink-faint">why: {t.assignReason}</p>}
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => notes !== (t.notes ?? "") && void act(`n-${t.id}`, { action: "update", id: t.id, notes }, () => "Notes saved.")}
            rows={2}
            placeholder="Your notes (sent along when you Start it)"
            aria-label="Notes"
            className="w-full resize-y rounded-md border border-line bg-transparent px-2 py-1 text-[11px] text-ink outline-none"
          />
          <div className="flex flex-col">
            {[...t.history].reverse().slice(0, 8).map((h, i) => (
              <p key={i} className="font-mono text-[9px] text-ink-faint">
                {ago(h.at)} ago · {h.what}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

type LuView = NonNullable<View["levelup"]>;
type FolderPlace = { host: string; hostLabel: string; folder: string; tool: string; agent?: string; agentLabel?: string };

/** LevelUp (rule 46): the connection, and the areas (client / personal) work is filed under. */
function LevelupPanel({ lu, places, act, busy }: { lu: LuView; places: Record<string, Place[]>; act: Act; busy: string | null }) {
  const [url, setUrl] = useState(lu.url ?? "https://levelupnow.tools");
  const [key, setKey] = useState("");
  const [open, setOpen] = useState(!lu.connected);
  const [clients, setClients] = useState(lu.areas.clients.join(", "));
  const st = lu.status;
  const machines = useMemo(() => {
    const m = new Map<string, Place>();
    for (const list of Object.values(places)) for (const p of list) if (p.kind === "machine" && !m.has(p.key)) m.set(p.key, p);
    return [...m.values()].sort((a, b) => a.label.localeCompare(b.label) || a.folder.localeCompare(b.folder));
  }, [places]);
  const folderValue = (f?: FolderPlace) => (f ? (machines.find((p) => p.host === f.host && p.folder === f.folder && (p.tool ?? "") === f.tool && (p.agent ?? "") === (f.agent ?? ""))?.key ?? "custom") : "");
  const repos = Object.keys(lu.repoAreas).sort();
  return (
    <Panel title="LevelUp" right={<span className="font-mono text-[10px]" style={{ color: lu.connected ? (st?.ok === false ? ACCENTS.rose.base : ACCENTS.lime.base) : "var(--color-ink-faint)" }}>{lu.connected ? (st?.ok === false ? "can't reach LevelUp" : "connected") : "not connected"}</span>}>
      <div className="flex flex-col gap-3 p-4">
        <p className="text-[11px] leading-4 text-ink-faint">
          Hand tasks and projects to the fleet from LevelUp, your planning app. Mission Control checks LevelUp every minute (it never accepts connections), proposes who does each one and where, and starts it only after you approve, in LevelUp or here. What is waiting on you here is listed in LevelUp&apos;s Fleet panel.
        </p>
        {lu.connected ? (
          <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] text-ink-dim">
            <span>{lu.url}</span>
            {st && (
              <span style={{ color: st.ok ? undefined : ACCENTS.rose.base }}>
                {st.ok ? `checked ${ago(st.at)} ago · ${st.open ?? 0} open hand-off${st.open === 1 ? "" : "s"}${st.outboxCount != null ? ` · told LevelUp about ${st.outboxCount} waiting on you` : ""}` : `last try ${ago(st.at)} ago: ${st.error}`}
              </span>
            )}
            <span className="flex-1" />
            <SmallButton onClick={() => void act("lu-sync", { action: "levelup-sync" }, () => "Checked LevelUp.")} disabled={!!busy}>
              {busy === "lu-sync" ? "Checking…" : "Check now"}
            </SmallButton>
            <SmallButton onClick={() => setOpen(!open)}>{open ? "Hide areas" : "Areas"}</SmallButton>
            <SmallButton onClick={() => void act("lu-off", { action: "levelup-disconnect" }, () => "Disconnected from LevelUp. Make a new key there to connect again.")} disabled={!!busy} title="Forget the key on this machine">
              Disconnect
            </SmallButton>
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-0.5 font-mono text-[10px] text-ink-dim">
              LevelUp address
              <input value={url} onChange={(e) => setUrl(e.target.value)} className="w-64 rounded-md border border-line bg-transparent px-2 py-1 text-[11px] text-ink outline-none" />
            </label>
            <label className="flex flex-col gap-0.5 font-mono text-[10px] text-ink-dim">
              Key (LevelUp → Fleet → Make a key)
              <input type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" placeholder="luf_…" className="w-72 rounded-md border border-line bg-transparent px-2 py-1 text-[11px] text-ink outline-none" />
            </label>
            <SmallButton accent onClick={() => void act("lu-on", { action: "levelup-connect", url, key }, () => "Connected to LevelUp.").then(() => setKey(""))} disabled={!!busy || !key}>
              {busy === "lu-on" ? "Connecting…" : "Connect"}
            </SmallButton>
            <span className="font-mono text-[9px] text-ink-faint">Connect on the machine whose Work page you use; the key stays on this machine.</span>
          </div>
        )}
        {open && (
          <div className="flex flex-col gap-3 rounded-lg border border-line p-3">
            <div>
              <p className="text-[12px] font-semibold text-ink">Areas</p>
              <p className="text-[11px] text-ink-faint">Client work (LSI Media, CommunityForce, MeYouSocial, and any you add) and Personal. LevelUp hand-offs carry their area; repositories get one here.</p>
            </div>
            <label className="flex flex-wrap items-center gap-2 font-mono text-[10px] text-ink-dim">
              more clients
              <input value={clients} onChange={(e) => setClients(e.target.value)} onBlur={() => clients !== lu.areas.clients.join(", ") && void act("lu-cl", { action: "area-clients", clients: clients.split(",") }, () => "Saved.")} placeholder="comma separated" className="w-72 rounded-md border border-line bg-transparent px-2 py-1 text-[11px] text-ink outline-none" />
            </label>
            <div className="flex flex-col gap-1">
              <p className="font-mono text-[10px] text-ink-dim">Work folder per area: where a hand-off that names no repository runs, and may change files once approved. Without one it answers in writing only.</p>
              {lu.areas.names.map((n) => (
                <label key={n} className="flex flex-wrap items-center gap-2 font-mono text-[10px] text-ink">
                  <span className="w-32">{n}</span>
                  <select
                    value={folderValue(lu.areas.folders[n])}
                    onChange={(e) => {
                      const p = machines.find((x) => x.key === e.target.value);
                      void act(`lu-f-${n}`, { action: "area-folder", area: n, place: p ? { host: p.host, hostLabel: p.hostLabel, folder: p.folder, tool: p.tool, agent: p.agent, agentLabel: p.agentLabel } : null }, () => (p ? `${n}: ${p.label} in ${p.folder}.` : `${n}: no work folder (answers only).`));
                    }}
                    aria-label={`Work folder for ${n}`}
                    className="max-w-[420px] rounded-md border border-line bg-transparent px-1.5 py-0.5 font-mono text-[10px] text-ink"
                  >
                    <option value="" style={{ background: "var(--color-panel)" }}>none: answer in writing</option>
                    {folderValue(lu.areas.folders[n]) === "custom" && (
                      <option value="custom" style={{ background: "var(--color-panel)" }}>
                        {lu.areas.folders[n].hostLabel} · {lu.areas.folders[n].folder}
                      </option>
                    )}
                    {machines.map((p) => (
                      <option key={p.key} value={p.key} style={{ background: "var(--color-panel)" }}>
                        {p.label} · {p.folder}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            {repos.length > 0 && (
              <details>
                <summary className="cursor-pointer font-mono text-[10px] text-ink-dim">
                  Repositories by area ({repos.filter((r) => lu.repoAreas[r]).length} of {repos.length} have one)
                </summary>
                <div className="mt-2 grid gap-1 md:grid-cols-2">
                  {repos.map((r) => (
                    <label key={r} className="flex items-center gap-2 font-mono text-[10px] text-ink">
                      <span className="min-w-0 flex-1 truncate">{r}</span>
                      <select value={lu.repoAreas[r] ?? ""} onChange={(e) => void act(`lu-r-${r}`, { action: "area-repo", repo: r, area: e.target.value || null }, () => `${r}: ${e.target.value || "no area"}.`)} aria-label={`Area for ${r}`} className="rounded-md border border-line bg-transparent px-1.5 py-0.5 font-mono text-[10px] text-ink">
                        <option value="" style={{ background: "var(--color-panel)" }}>no area</option>
                        {lu.areas.names.map((n) => (
                          <option key={n} value={n} style={{ background: "var(--color-panel)" }}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}
