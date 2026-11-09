"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Markdown from "../Markdown";
import type { SessionSummary } from "@/lib/sessions";
import type { SessionJob } from "@/lib/sessionActions";
import type { Thread, ThreadEntry } from "@/lib/sessionThread";
import type { HubSnapshot } from "@/lib/activity";
import { ACCENTS } from "@/lib/accents";
import { ago, stamp } from "./common";
import { ConversationView } from "./Conversation";

/**
 * Everything you can DO with a session on the Projects page: read its full
 * thread (tool calls included), reply to it (continues the real session),
 * open it in a terminal / its folder / VS Code, move or hide it - and start
 * new sessions in a project's folder. Backend: /api/hub/sessions.
 */

type Level = "off" | "answer" | "edit";
const ACTIVE = ["queued", "sent", "running"];

export async function sessionsPost(body: object): Promise<{ ok?: boolean; error?: string; message?: string; job?: SessionJob }> {
  try {
    const r = await fetch("/api/hub/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return await r.json();
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Jobs started from the Projects page; polls fast while any is in flight. */
export function useSessionJobs() {
  const [jobs, setJobs] = useState<SessionJob[]>([]);
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/hub/sessions");
      if (r.ok) setJobs(((await r.json()) as { jobs: SessionJob[] }).jobs ?? []);
    } catch {
      /* next poll */
    }
  }, []);
  const active = jobs.some((j) => ACTIVE.includes(j.status));
  useEffect(() => {
    load();
    const t = setInterval(load, active ? 3_000 : 30_000);
    window.addEventListener("mc-session-jobs", load);
    return () => {
      clearInterval(t);
      window.removeEventListener("mc-session-jobs", load);
    };
  }, [load, active]);
  return { jobs, reloadJobs: load };
}

/** What another machine lets this one do with its sessions. */
export function machineInfo(hub: HubSnapshot | null, host: string): { local: boolean; label: string; level: Level } {
  if (!hub || host === hub.host) return { local: true, label: "this machine", level: "edit" };
  const m = hub.machines.find((x) => x.host === host);
  return { local: false, label: m?.label ?? host, level: (m?.acceptsReplies as Level) ?? "off" };
}

export function SmallButton({ onClick, children, title, disabled, accent }: { onClick: () => void; children: ReactNode; title?: string; disabled?: boolean; accent?: boolean }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={title}
      disabled={disabled}
      className="cursor-pointer rounded-md border px-2 py-1 font-mono text-[10px] transition-colors hover:bg-white/[0.06] disabled:cursor-default disabled:opacity-40"
      style={accent ? { borderColor: "var(--page-accent)", color: "var(--page-accent)" } : { borderColor: "var(--color-line)", color: "var(--color-ink-dim)" }}
    >
      {children}
    </button>
  );
}

const when = (ts: number) => (ts ? new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");

// ─── the thread ───

function ToolEntry({ e }: { e: Extract<ThreadEntry, { kind: "tool" }> }) {
  const tone = e.isError ? ACCENTS.rose : ACCENTS.cyan;
  return (
    <details className="group rounded-lg border border-line bg-black/[0.06]">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-1.5 font-mono text-[10.5px] text-ink-dim hover:text-ink">
        <span className="shrink-0 rounded px-1 py-px text-[9px] font-bold" style={{ background: tone.soft, color: tone.base }}>
          {e.isError ? "ERROR" : "TOOL"}
        </span>
        <span className="min-w-0 flex-1 truncate">{e.summary}</span>
        {e.output === undefined && <span className="shrink-0 text-ink-faint">no result</span>}
        <span className="shrink-0 text-ink-faint group-open:rotate-90">›</span>
      </summary>
      <div className="flex flex-col gap-2 border-t border-line px-2.5 py-2">
        <div>
          <p className="pb-0.5 font-mono text-[9px] uppercase tracking-wider text-ink-faint">Input</p>
          <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md bg-black/[0.12] p-2 font-mono text-[10.5px] leading-4 text-ink-dim">{e.input}</pre>
        </div>
        {e.output !== undefined && (
          <div>
            <p className="pb-0.5 font-mono text-[9px] uppercase tracking-wider text-ink-faint">Result</p>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-black/[0.12] p-2 font-mono text-[10.5px] leading-4 text-ink-dim">
              {e.output || "(empty)"}
            </pre>
          </div>
        )}
      </div>
    </details>
  );
}

function ThreadEntries({ thread, tool, showTools }: { thread: Thread; tool: string; showTools: boolean }) {
  const name = tool === "claude" ? "Claude" : "Codex";
  const shown = showTools ? thread.entries : thread.entries.filter((e) => e.kind !== "tool");
  return (
    <div className="flex flex-col gap-2">
      {shown.map((e, i) => {
        if (e.kind === "user") {
          return (
            <div key={i} className="ml-6 rounded-xl px-3 py-2" style={{ background: "color-mix(in srgb, var(--page-accent) 12%, transparent)" }}>
              <p className="pb-1 font-mono text-[10px] font-semibold" style={{ color: "var(--page-accent)" }}>
                You <span className="font-normal text-ink-faint">· {when(e.ts)}</span>
              </p>
              <div className="text-xs">
                <Markdown>{e.text}</Markdown>
              </div>
            </div>
          );
        }
        if (e.kind === "assistant") {
          return (
            <div key={i} className="mr-6 rounded-xl border border-line px-3 py-2">
              <p className="pb-1 font-mono text-[10px] font-semibold text-ink">
                {name} <span className="font-normal text-ink-faint">· {when(e.ts)}</span>
              </p>
              <div className="text-xs">
                <Markdown>{e.text}</Markdown>
              </div>
            </div>
          );
        }
        if (e.kind === "tool") return <ToolEntry key={e.id + i} e={e} />;
        return (
          <p key={i} className="py-1 text-center font-mono text-[10px] italic text-ink-faint">
            {e.text} · {when(e.ts)}
          </p>
        );
      })}
    </div>
  );
}

/**
 * Full thread. On this machine it's read live (and refreshed while the session
 * is active); for another machine's session it shows the shared conversation
 * and can fetch the full thread through the vault.
 */
function ThreadView({ s, local, level, machineLabel, refresh, jobs, reloadJobs }: {
  s: SessionSummary;
  local: boolean;
  level: Level;
  machineLabel: string;
  refresh: number;
  jobs: SessionJob[];
  reloadJobs: () => void;
}) {
  const [thread, setThread] = useState<Thread | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [all, setAll] = useState(false);
  const [showTools, setShowTools] = useState(true);
  const [asking, setAsking] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const scrolled = useRef(false);

  // a full thread fetched from another machine
  const fetched = useMemo(
    () => jobs.filter((j) => j.mode === "thread" && j.key === s.key).sort((a, b) => b.createdAt - a.createdAt)[0],
    [jobs, s.key],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const url = local
        ? `/api/hub/sessions?thread=${encodeURIComponent(s.key)}&limit=${all ? 0 : 600}`
        : fetched?.status === "done"
          ? `/api/hub/sessions?jobThread=${encodeURIComponent(fetched.id)}`
          : null;
      if (!url) {
        setThread(null);
        return;
      }
      const r = await fetch(url);
      const b = (await r.json()) as Thread & { error?: string };
      if (r.ok) {
        setThread(b);
        setError(null);
      } else setError(b.error ?? `HTTP ${r.status}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [local, s.key, all, fetched?.id, fetched?.status]);

  useEffect(() => {
    scrolled.current = false;
  }, [s.key]);
  useEffect(() => {
    load();
  }, [load, refresh]);
  // live sessions on this machine: keep the thread current
  useEffect(() => {
    if (!local || s.status === "ended") return;
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [local, s.status, load]);
  useEffect(() => {
    if (thread && box.current && !scrolled.current) {
      box.current.scrollTop = box.current.scrollHeight;
      scrolled.current = true;
    }
  }, [thread]);

  const askRemote = async () => {
    setAsking("Asking…");
    const r = await sessionsPost({ action: "thread", key: s.key });
    setAsking(r.error ?? null);
    reloadJobs();
  };

  const tools = thread?.entries.filter((e) => e.kind === "tool").length ?? 0;
  const msgs = thread ? thread.entries.length - tools : 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] text-ink-faint">
        <span className="panel-title">Thread</span>
        {thread && (
          <span>
            {msgs} messages · {tools} tool calls
            {thread.truncated ? ` · newest ${thread.entries.length} of ${thread.total}` : ""}
            {!local && fetched?.finishedAt ? ` · fetched from ${machineLabel} ${ago(fetched.finishedAt)} ago` : ""}
          </span>
        )}
        {loading && <span>loading…</span>}
        <span className="flex-1" />
        {thread && (
          <label className="flex cursor-pointer items-center gap-1">
            <input type="checkbox" checked={showTools} onChange={(e) => setShowTools(e.target.checked)} /> tool calls
          </label>
        )}
        {local && thread?.truncated && <SmallButton onClick={() => setAll(true)}>Load all {thread.total}</SmallButton>}
        {local && <SmallButton onClick={load}>Refresh</SmallButton>}
        {!local && level !== "off" && (
          <SmallButton onClick={askRemote} disabled={Boolean(fetched && ACTIVE.includes(fetched.status))}>
            {fetched && ACTIVE.includes(fetched.status) ? "Fetching…" : thread ? "Fetch again" : `Load full thread from ${machineLabel}`}
          </SmallButton>
        )}
      </div>
      {error && <p className="text-[11px] text-ink-faint">{error}</p>}
      {asking && <p className="text-[11px] text-ink-faint">{asking}</p>}
      {!local && fetched && ACTIVE.includes(fetched.status) && (
        <p className="text-[11px] text-ink-faint">
          Asked {machineLabel} for the full thread {ago(fetched.createdAt)} ago - it arrives through OneDrive, usually within a minute or two.
        </p>
      )}
      {!local && fetched && (fetched.status === "error" || fetched.status === "expired") && <p className="text-[11px] text-ink-faint">{fetched.error}</p>}
      {thread ? (
        <div ref={box} className="max-h-[62vh] overflow-y-auto rounded-xl border border-line bg-black/[0.04] p-3">
          {thread.entries.length === 0 ? <p className="text-[11px] text-ink-faint">Nothing in this session yet.</p> : <ThreadEntries thread={thread} tool={s.tool} showTools={showTools} />}
        </div>
      ) : (
        !local && (
          <>
            <p className="text-[11px] leading-4 text-ink-faint">
              {level === "off"
                ? `This session is on ${machineLabel}. Below is the conversation it shares (messages only). To see tool calls too, or to reply, turn on "Replies from my other machines" on ${machineLabel} (Fleet → Sharing).`
                : `This session is on ${machineLabel}. Below is the conversation it shares (messages only) - load the full thread for tool calls and results.`}
            </p>
            <ConversationView sessionKey={s.key} />
          </>
        )
      )}
    </div>
  );
}

// ─── jobs (replies / new sessions) ───

export function JobBubble({ job, onOpenSession, knownKeys }: { job: SessionJob; onOpenSession?: (key: string) => void; knownKeys?: Set<string> }) {
  const [busy, setBusy] = useState(false);
  const toolName = job.tool === "claude" ? "Claude" : "Codex";
  const final = !ACTIVE.includes(job.status);
  const status =
    job.status === "queued"
      ? "Waiting to start…"
      : job.status === "sent"
        ? `Sent to ${job.hostLabel} through the vault - waiting for it to pick it up (OneDrive sync can take a minute)`
        : job.status === "running"
          ? `${toolName} is working on ${job.hostLabel}${job.startedAt ? ` (started ${ago(job.startedAt)} ago)` : ""}…`
          : null;
  const newKey = job.resultKey && job.resultKey !== job.key ? job.resultKey : undefined;
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-dashed border-line px-3 py-2">
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 font-mono text-[10px] text-ink-faint">
          <span style={{ color: "var(--page-accent)" }}>You, from Mission Control</span> · {when(job.createdAt)}
          {job.requestedByLabel ? ` · asked from ${job.requestedByLabel}` : ""} · {job.access === "edit" ? "can edit files" : "answer only"}
          {job.fork ? " · as a new branch" : ""}
        </p>
        {final && (
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await sessionsPost({ action: "dismiss", id: job.id });
              window.dispatchEvent(new Event("mc-session-jobs"));
            }}
            title="Remove from this list"
            className="cursor-pointer font-mono text-[11px] text-ink-faint hover:text-ink"
          >
            ✕
          </button>
        )}
      </div>
      <p className="whitespace-pre-wrap text-xs text-ink">
        {job.prompt ||
          (job.mode === "import"
            ? `Move "${job.title ?? "this session"}" to ${job.hostLabel}`
            : job.mode === "export"
              ? `Bring "${job.title ?? "this session"}" here from ${job.hostLabel}`
              : job.mode === "stop"
                ? `Stop "${job.title ?? "this session"}" on ${job.hostLabel}`
                : job.mode === "thread"
                  ? `Load the full thread from ${job.hostLabel}`
                  : "")}
      </p>
      {status && (
        <p className="flex items-center gap-2 font-mono text-[10px]" style={{ color: ACCENTS.cyan.base }}>
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: ACCENTS.cyan.base }} /> {status}
        </p>
      )}
      {(job.status === "error" || job.status === "expired") && (
        <p className="text-[11px]" style={{ color: ACCENTS.rose.base }}>
          {job.error}
        </p>
      )}
      {job.status === "done" && job.reply !== undefined && (
        <div className="rounded-lg border border-line px-3 py-2">
          <p className="pb-1 font-mono text-[10px] font-semibold text-ink">
            {toolName} <span className="font-normal text-ink-faint">· {job.finishedAt ? when(job.finishedAt) : ""}</span>
          </p>
          <div className="max-h-[50vh] overflow-y-auto text-xs">
            <Markdown>{job.reply || "(no text reply)"}</Markdown>
          </div>
        </div>
      )}
      {job.status === "done" && newKey && onOpenSession && (
        <p className="font-mono text-[10px] text-ink-faint">
          {job.mode === "new" ? "Started a new session." : "Continued as a new branch of this session."}{" "}
          {knownKeys?.has(newKey) ? (
            <button type="button" onClick={() => onOpenSession(newKey)} className="cursor-pointer underline" style={{ color: "var(--page-accent)" }}>
              Open it
            </button>
          ) : (
            "It appears in the list within a minute."
          )}
        </p>
      )}
    </div>
  );
}

function Composer({
  placeholder,
  tool,
  allowEdit,
  showFork,
  forkDefault,
  forkLocked,
  disabledReason,
  hint,
  onSend,
  extra,
}: {
  placeholder: string;
  tool: string;
  allowEdit: boolean;
  showFork: boolean;
  forkDefault: boolean;
  forkLocked: boolean;
  disabledReason?: string;
  hint: string;
  onSend: (prompt: string, access: "answer" | "edit", fork: boolean) => Promise<string | undefined>;
  extra?: ReactNode;
}) {
  const [text, setText] = useState("");
  const [access, setAccess] = useState<"answer" | "edit">("answer");
  const [fork, setFork] = useState(forkDefault);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => setFork(forkDefault), [forkDefault]);

  const send = async () => {
    if (!text.trim() || busy || disabledReason) return;
    setBusy(true);
    setErr(null);
    const e = await onSend(text.trim(), access, fork);
    setBusy(false);
    if (e) setErr(e);
    else setText("");
  };

  return (
    <form
      className="flex flex-col gap-2 rounded-xl border border-line p-3"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            send();
          }
        }}
        disabled={Boolean(disabledReason)}
        rows={3}
        placeholder={disabledReason ?? placeholder}
        aria-label={placeholder}
        className="min-h-[70px] w-full resize-y rounded-lg border border-line bg-transparent px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-line-bright disabled:opacity-60"
      />
      <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] text-ink-dim">
        {extra}
        <select
          value={access}
          onChange={(e) => setAccess(e.target.value as "answer" | "edit")}
          aria-label="What it may do"
          className="rounded-md border border-line bg-transparent px-1.5 py-1 text-[10px] text-ink"
          title="Answer only: it can read and answer, but anything that needs approval (editing files, running commands) is refused. Can edit files: file edits are allowed; commands still need approval."
        >
          <option value="answer" style={{ background: "var(--color-panel)" }}>
            Answer only
          </option>
          <option value="edit" disabled={!allowEdit} style={{ background: "var(--color-panel)" }}>
            Can edit files{allowEdit ? "" : " (not allowed there)"}
          </option>
        </select>
        {showFork && (
          <label className="flex cursor-pointer items-center gap-1" title={forkLocked ? "The session is open right now, so the reply goes into a new branch of it - the two can't collide." : "Leave the original session as it is and continue in a new branch."}>
            <input type="checkbox" checked={fork || forkLocked} disabled={forkLocked} onChange={(e) => setFork(e.target.checked)} /> as a new branch
            {forkLocked ? " (session is open)" : ""}
          </label>
        )}
        <span className="flex-1" />
        <span className="text-ink-faint">Ctrl+Enter</span>
        <button
          type="submit"
          disabled={busy || !text.trim() || Boolean(disabledReason)}
          className="cursor-pointer rounded-md border px-3 py-1 font-mono text-[11px] font-semibold transition-colors hover:bg-white/[0.06] disabled:cursor-default disabled:opacity-40"
          style={{ borderColor: "var(--page-accent)", color: "var(--page-accent)" }}
        >
          {busy ? "Sending…" : `Send to ${tool === "codex" ? "Codex" : "Claude"}`}
        </button>
      </div>
      <p className="text-[10px] leading-4 text-ink-faint">{hint}</p>
      {err && (
        <p className="text-[11px]" style={{ color: ACCENTS.rose.base }}>
          {err}
        </p>
      )}
    </form>
  );
}

// ─── move a session to another machine ───

function HandoffForm({ s, hub, onSent }: { s: SessionSummary; hub: HubSnapshot | null; onSent: () => void }) {
  const m = machineInfo(hub, s.host);
  const targets = (hub?.machines ?? []).filter((x) => x.host !== s.host);
  const [target, setTarget] = useState(targets.find((t) => t.acceptsReplies !== "off")?.host ?? targets[0]?.host ?? "");
  // where the project lives on the receiving machine, if a session there knows it
  const folderOn = (host: string | undefined) => hub?.sessions.find((x) => x.host === host && x.project === s.project && x.folder)?.folder ?? s.cwd;
  const [folder, setFolder] = useState(m.local ? folderOn(target) : folderOn(hub?.host));
  const [openIt, setOpenIt] = useState(true);
  const [hide, setHide] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (m.local) setFolder(folderOn(target));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  const t = targets.find((x) => x.host === target);
  const blocked = m.local ? (!t ? "No other machine in the group." : t.acceptsReplies === "off" ? `${t.label} doesn't accept requests from other machines (Fleet → Sharing there).` : null) : m.level === "off" ? `${m.label} doesn't accept requests from other machines (Fleet → Sharing there).` : null;

  const send = async () => {
    setBusy(true);
    setErr(null);
    const r = await sessionsPost(
      m.local
        ? { action: "import", key: s.key, host: target, folder: folder.trim(), openTerminal: openIt, hideSource: hide }
        : { action: "export", key: s.key, folder: folder.trim(), openTerminal: openIt, hideSource: hide },
    );
    setBusy(false);
    if (r.error) setErr(r.error);
    else onSent();
  };

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line p-3 text-[11px] text-ink-dim">
      <p className="font-semibold text-ink">{m.local ? "Move this session to another machine" : `Bring this session here from ${m.label}`}</p>
      <p className="text-[10px] leading-4 text-ink-faint">
        Copies the whole conversation into Claude Code on the {m.local ? "other" : "this"} machine, with folder paths changed to where the project lives there, so you
        can keep going with claude --resume. The project&apos;s files themselves aren&apos;t copied - the folder must already exist there (a clone, or the same
        OneDrive folder).
      </p>
      <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
        {m.local && (
          <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Machine" className="rounded-md border border-line bg-transparent px-1.5 py-1 text-[10px] text-ink">
            {targets.map((x) => (
              <option key={x.host} value={x.host} style={{ background: "var(--color-panel)" }}>
                {x.label}
                {x.acceptsReplies === "off" ? " (not accepting)" : ""}
              </option>
            ))}
          </select>
        )}
        <span>folder there:</span>
        <input
          value={folder}
          onChange={(e) => setFolder(e.target.value)}
          aria-label="Folder on the receiving machine"
          className="min-w-[260px] flex-1 rounded-md border border-line bg-transparent px-2 py-1 text-[10px] text-ink outline-none"
        />
      </div>
      <div className="flex flex-wrap items-center gap-3 font-mono text-[10px]">
        <label className="flex cursor-pointer items-center gap-1">
          <input type="checkbox" checked={openIt} onChange={(e) => setOpenIt(e.target.checked)} /> open it in a terminal {m.local ? "there" : "here"}
        </label>
        <label className="flex cursor-pointer items-center gap-1">
          <input type="checkbox" checked={hide} onChange={(e) => setHide(e.target.checked)} /> hide the {m.local ? "original" : "other machine's copy"} from Projects
        </label>
        <span className="flex-1" />
        <button
          type="button"
          onClick={send}
          disabled={busy || Boolean(blocked) || !folder.trim()}
          className="cursor-pointer rounded-md border px-3 py-1 font-mono text-[11px] font-semibold transition-colors hover:bg-white/[0.06] disabled:cursor-default disabled:opacity-40"
          style={{ borderColor: "var(--page-accent)", color: "var(--page-accent)" }}
        >
          {busy ? "Moving…" : m.local ? `Move to ${t?.label ?? "…"}` : "Bring it here"}
        </button>
      </div>
      {(blocked || err) && <p style={{ color: ACCENTS.rose.base }}>{err ?? blocked}</p>}
    </div>
  );
}

// ─── one session, opened ───

export function SessionDetail({
  s,
  hub,
  jobs,
  reloadJobs,
  reloadHub,
  projectNames,
  onOpenSession,
}: {
  s: SessionSummary;
  hub: HubSnapshot | null;
  jobs: SessionJob[];
  reloadJobs: () => void;
  reloadHub: () => void;
  projectNames: string[];
  onOpenSession: (key: string) => void;
}) {
  const m = machineInfo(hub, s.host);
  const [msg, setMsg] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [moveTo, setMoveTo] = useState(s.project === "Unsorted" ? "" : s.project);
  const resume = s.tool === "claude" ? `claude --resume ${s.id}` : `codex resume ${s.id}`;
  const copyCmd = `cd "${s.cwd}" && ${resume}`;

  const [stopAsk, setStopAsk] = useState(false);
  const [handoff, setHandoff] = useState(false);
  const interactive = !/^sdk|exec/i.test(s.origin ?? "");

  const mine = useMemo(
    () =>
      jobs
        .filter((j) => (j.mode === "reply" || j.mode === "import" || j.mode === "export" || j.mode === "stop") && (j.key === s.key || j.resultKey === s.key))
        .sort((a, b) => a.createdAt - b.createdAt),
    [jobs, s.key],
  );
  // a finished in-place reply is part of the thread itself - refetch it then
  const refresh = mine.filter((j) => j.mode === "reply" && j.status === "done").length;
  const knownKeys = useMemo(() => new Set(hub?.sessions.map((x) => x.key)), [hub]);
  const showJobs = mine.filter((j) => j.mode !== "reply" || ACTIVE.includes(j.status) || j.status !== "done" || !m.local || (j.resultKey && j.resultKey !== s.key));

  const stop = async () => {
    setStopAsk(false);
    const r = await act({ action: "stop", key: s.key });
    if (!r.error && r.job) setMsg(r.job.reply ?? (r.job.status === "sent" ? `Sent to ${m.label}.` : "Stopped."));
    reloadJobs();
    reloadHub();
  };

  const act = async (body: object) => {
    setMsg("…");
    const r = await sessionsPost(body);
    setMsg(r.error ?? r.message ?? "Done.");
    return r;
  };

  const busy = s.status !== "ended";
  return (
    <div className="flex flex-col gap-3 pb-4 pt-1" onClick={(e) => e.stopPropagation()}>
      <div className="flex flex-wrap items-center gap-1.5">
        {m.local ? (
          <>
            <SmallButton accent onClick={() => act({ action: "open", what: "terminal", key: s.key })} title={`Opens a terminal in ${s.cwd} running: ${resume}`}>
              Open in terminal
            </SmallButton>
            <SmallButton onClick={() => act({ action: "open", what: "folder", key: s.key })} title={s.folder || s.cwd}>
              Open folder
            </SmallButton>
            <SmallButton onClick={() => act({ action: "open", what: "editor", key: s.key })}>VS Code</SmallButton>
          </>
        ) : null}
        <SmallButton
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(copyCmd);
              setMsg(m.local ? "Resume command copied." : `Resume command copied - paste it in a terminal on ${m.label}.`);
            } catch {
              setMsg(copyCmd);
            }
          }}
          title={copyCmd}
        >
          Copy resume command
        </SmallButton>
        <SmallButton onClick={() => setMoving((v) => !v)}>Move to project…</SmallButton>
        <SmallButton
          onClick={async () => {
            const r = await act({ action: "hide", keys: [s.key], hidden: !s.hidden });
            if (!r.error) reloadHub();
          }}
          title={s.hidden ? "Show this session in Projects again" : "Hide this session from Projects (nothing is deleted)"}
        >
          {s.hidden ? "Unhide" : "Hide"}
        </SmallButton>
        {s.tool === "claude" && (
          <SmallButton onClick={() => setHandoff((v) => !v)} title="Continue this session on a different machine">
            {m.local ? "Move to another machine…" : "Bring to this machine…"}
          </SmallButton>
        )}
        {busy &&
          (stopAsk ? (
            <span className="flex flex-wrap items-center gap-1.5 font-mono text-[10px]" style={{ color: ACCENTS.rose.base }}>
              {interactive ? `It's open in ${s.tool === "claude" ? "the Claude app or a terminal" : "Codex"} on ${m.label} - stopping ends it there.` : "Stop this run?"}
              <SmallButton onClick={stop}>Stop it</SmallButton>
              <SmallButton onClick={() => setStopAsk(false)}>Cancel</SmallButton>
            </span>
          ) : (
            <SmallButton onClick={() => (interactive ? setStopAsk(true) : stop())} title="Stop this session (asks first when it's open in an app or terminal)">
              Stop
            </SmallButton>
          ))}
        {msg && <span className="font-mono text-[10px] text-ink-faint">{msg}</span>}
      </div>

      {handoff && <HandoffForm s={s} hub={hub} onSent={() => (reloadJobs(), setHandoff(false))} />}

      {moving && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await act({ action: "move", keys: [s.key], project: moveTo.trim() });
            if (!r.error) {
              setMoving(false);
              reloadHub();
            }
          }}
        >
          <input
            list="mc-project-names"
            value={moveTo}
            onChange={(e) => setMoveTo(e.target.value)}
            placeholder="Project name (empty = automatic)"
            aria-label="Move to project"
            className="min-w-0 flex-1 rounded-md border border-line bg-transparent px-2 py-1 text-xs text-ink outline-none"
          />
          <datalist id="mc-project-names">
            {projectNames.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
          <button
            type="submit"
            className="cursor-pointer rounded-md border px-2 py-1 font-mono text-[10px] transition-colors hover:bg-white/[0.06]"
            style={{ borderColor: "var(--page-accent)", color: "var(--page-accent)" }}
          >
            Move
          </button>
        </form>
      )}

      <p className="font-mono text-[10px] leading-4 text-ink-faint">
        {s.tool === "claude" ? "Claude Code" : "Codex"} · {m.local ? "this machine" : m.label} · {s.status === "ended" ? "closed" : `open now (${s.status})`}
        {s.model ? ` · ${s.model}` : ""} · started {stamp(s.startedAt)} · last changed {stamp(s.updatedAt)}
        <br />
        {s.cwd}
      </p>

      <ThreadView s={s} local={m.local} level={m.level} machineLabel={m.label} refresh={refresh} jobs={jobs} reloadJobs={reloadJobs} />

      {showJobs.map((j) => (
        <JobBubble key={j.id} job={j} onOpenSession={onOpenSession} knownKeys={knownKeys} />
      ))}

      <Composer
        placeholder={`Reply to this session…`}
        tool={s.tool}
        allowEdit={m.level === "edit"}
        showFork={s.tool === "claude"}
        forkDefault={busy}
        forkLocked={m.local && busy}
        disabledReason={!m.local && m.level === "off" ? `Replies to ${m.label} are off - turn on "Replies from my other machines" there (Fleet → Sharing).` : undefined}
        hint={`Continues this session on ${m.local ? "this machine" : m.label} with your ${s.tool === "claude" ? "Claude" : "ChatGPT"} subscription (${s.tool === "claude" ? "claude --resume" : "codex exec resume"}, in ${s.cwd}). The reply is saved in the session itself, so the ${s.tool === "claude" ? "Claude app and terminal" : "Codex app"} show it too.`}
        onSend={async (prompt, access, fork) => {
          const r = await sessionsPost({ action: "reply", key: s.key, prompt, access, fork });
          reloadJobs();
          return r.error;
        }}
      />
    </div>
  );
}

// ─── start a new session in a project ───

export function NewSessionPanel({
  project,
  folder,
  host,
  hub,
  jobs,
  reloadJobs,
  onOpenSession,
}: {
  project: string;
  folder: string;
  host: string;
  hub: HubSnapshot | null;
  jobs: SessionJob[];
  reloadJobs: () => void;
  onOpenSession: (key: string) => void;
}) {
  const m = machineInfo(hub, host);
  const [tool, setTool] = useState<"claude" | "codex">("claude");
  const knownKeys = useMemo(() => new Set(hub?.sessions.map((x) => x.key)), [hub]);
  const started = jobs.filter((j) => j.mode === "new" && (j.project === project || j.cwd === folder)).sort((a, b) => a.createdAt - b.createdAt);
  return (
    <div className="flex flex-col gap-2">
      {started.map((j) => (
        <JobBubble key={j.id} job={j} onOpenSession={onOpenSession} knownKeys={knownKeys} />
      ))}
      <Composer
        placeholder={`Start a new session in ${project}…`}
        tool={tool}
        allowEdit={m.level === "edit"}
        showFork={false}
        forkDefault={false}
        forkLocked={false}
        disabledReason={!m.local && m.level === "off" ? `This folder is on ${m.label}, which doesn't accept requests from other machines (Fleet → Sharing there).` : undefined}
        hint={`Runs in ${folder} on ${m.local ? "this machine" : m.label}, with your ${tool === "claude" ? "Claude" : "ChatGPT"} subscription. It becomes a normal session in this project - open it afterwards to keep going.`}
        extra={
          <select
            value={tool}
            onChange={(e) => setTool(e.target.value as "claude" | "codex")}
            aria-label="Which tool"
            className="rounded-md border border-line bg-transparent px-1.5 py-1 text-[10px] text-ink"
          >
            <option value="claude" style={{ background: "var(--color-panel)" }}>
              Claude Code
            </option>
            <option value="codex" style={{ background: "var(--color-panel)" }}>
              Codex
            </option>
          </select>
        }
        onSend={async (prompt, access) => {
          const r = await sessionsPost({ action: "new", host, folder, tool, project, prompt, access });
          reloadJobs();
          return r.error;
        }}
      />
    </div>
  );
}
