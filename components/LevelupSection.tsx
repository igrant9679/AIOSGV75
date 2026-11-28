"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Markdown from "./Markdown";
import type { RepoTask } from "@/lib/repoTasks";

/**
 * /levelup (a module, rule 53): the hand-offs from LevelUp, the owner's planning app, in one place —
 * connect, approve a plan, follow the work, review a result. It shows and acts on the same Work tasks as
 * Work does (kept on the Work home), filtered to the ones that came from LevelUp.
 */

interface View {
  tasks: RepoTask[];
  levelup?: { connected: boolean; url: string | null; status: { ok: boolean; at: number; error?: string; open?: number; outboxCount?: number } | null; areas: { names: string[]; folders: Record<string, { hostLabel: string; folder: string }> } };
  home?: { label: string; here: boolean; unreachable?: boolean } | null;
  error?: string;
}
const who = (t: RepoTask) => (t.assignee.kind === "machine" ? `${t.assignee.hostLabel} · ${t.assignee.agentLabel ?? (t.assignee.tool === "claude" ? "Claude Code" : t.assignee.tool)}` : t.assignee.kind === "teammate" ? t.assignee.name : "nobody yet");
const primary = "cursor-pointer rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40";
const ghost = "cursor-pointer rounded-lg border border-line px-3 py-1.5 text-[12px] text-ink-dim";
const field = "rounded-lg border border-line bg-transparent px-3 py-2 text-[13px] text-ink outline-none";

export default function LevelupSection() {
  const [view, setView] = useState<View | null>(null);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [area, setArea] = useState("");
  const [url, setUrl] = useState("https://levelupnow.tools");
  const [key, setKey] = useState("");
  const load = useCallback(() => {
    fetch("/api/work").then((r) => r.json()).then((v: View) => { if (v.error) setMsg({ text: v.error, bad: true }); if (v.tasks) setView(v); }).catch((e: Error) => setMsg({ text: e.message, bad: true }));
  }, []);
  const live = view?.tasks.some((t) => t.origin && t.status === "doing");
  useEffect(() => {
    load();
    const t = setInterval(load, live ? 6000 : 30_000);
    return () => clearInterval(t);
  }, [load, live]);
  const act = async (name: string, body: object, ok: string) => {
    setBusy(name);
    setMsg(null);
    const r = await (await fetch("/api/work", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json().catch((e: Error) => ({ error: e.message }));
    setBusy(null);
    setMsg(r.error ? { text: r.error, bad: true } : { text: ok });
    load();
  };

  const all = useMemo(() => (view?.tasks ?? []).filter((t) => t.origin?.kind === "levelup"), [view]);
  const areas = useMemo(() => [...new Set(all.map((t) => (t.area ?? "No area").replace(/ · .*$/, "")))].sort(), [all]);
  const list = all.filter((t) => !area || (t.area ?? "No area").replace(/ · .*$/, "") === area);
  const lu = view?.levelup;
  const groups: { title: string; hint: string; items: RepoTask[]; color: string }[] = [
    { title: "Needs your approval", hint: "Mission Control proposed who does it and where. Nothing starts until you approve.", color: "var(--ac-amber)", items: list.filter((t) => t.approval !== "approved" && ["inbox", "todo"].includes(t.status)) },
    { title: "Ready for your review", hint: "Accept it here, or accept / send back in LevelUp.", color: "var(--ac-cyan)", items: list.filter((t) => t.status === "review") },
    { title: "In progress", hint: "", color: "var(--ac-violet)", items: list.filter((t) => t.status === "doing" || (t.approval === "approved" && t.status === "todo")) },
    { title: "Finished", hint: "", color: "var(--ac-lime)", items: list.filter((t) => t.status === "done" || t.status === "dismissed").slice(0, 20) },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="panel flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: lu?.connected ? (lu.status?.ok === false ? "var(--ac-rose)" : "var(--ac-lime)") : "var(--color-ink-faint)" }} />
          <p className="text-[14px] font-semibold text-ink">{lu?.connected ? (lu.status?.ok === false ? "Connected, but LevelUp can't be reached" : "Connected to LevelUp") : "Not connected yet"}</p>
          <span className="text-[12px] text-ink-faint">
            {lu?.connected ? `${lu.url ?? ""}${lu.status?.ok ? ` · ${lu.status.open ?? 0} open hand-off${lu.status.open === 1 ? "" : "s"}${lu.status.outboxCount != null ? ` · LevelUp shows ${lu.status.outboxCount} of your items from here` : ""}` : lu.status?.error ? ` · ${lu.status.error}` : ""}` : "Hand-offs are kept on the Work home and checked every minute."}
            {view?.home ? ` · kept on ${view.home.label}` : ""}
          </span>
          <span className="flex-1" />
          {lu?.connected && (
            <>
              {lu.url && <a href={lu.url} target="_blank" rel="noreferrer" className={ghost}>Open LevelUp ↗</a>}
              <button type="button" className={ghost} disabled={!!busy} onClick={() => void act("sync", { action: "levelup-sync" }, "Checked LevelUp.")}>{busy === "sync" ? "Checking…" : "Check now"}</button>
            </>
          )}
          <Link href="/work" className={ghost}>Areas and folders (in Work)</Link>
        </div>
        {lu && !lu.connected && (
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-[11px] text-ink-faint">LevelUp address<input value={url} onChange={(e) => setUrl(e.target.value)} className={`${field} w-64`} /></label>
            <label className="flex flex-col gap-1 text-[11px] text-ink-faint">Key (in LevelUp: Fleet → Make a key for Mission Control)<input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder="luf_…" className={`${field} w-80`} /></label>
            <button type="button" className={primary} style={{ background: "var(--ac-violet)" }} disabled={!key || !!busy} onClick={() => void act("connect", { action: "levelup-connect", url, key }, "Connected to LevelUp.").then(() => setKey(""))}>{busy === "connect" ? "Connecting…" : "Connect"}</button>
          </div>
        )}
        {msg && <p className="text-[12px]" style={{ color: msg.bad ? "var(--ac-rose)" : "var(--ac-lime)" }}>{msg.text}</p>}
      </div>

      {areas.length > 1 && (
        <span className="studio-seg self-start" style={{ display: "inline-flex", flexWrap: "wrap" }} role="group" aria-label="Area">
          <button type="button" aria-pressed={!area} onClick={() => setArea("")}>All areas</button>
          {areas.map((a) => <button key={a} type="button" aria-pressed={area === a} onClick={() => setArea(a)}>{a}</button>)}
        </span>
      )}

      {view && all.length === 0 && (
        <div className="panel p-6 text-[13px] text-ink-dim">
          No hand-offs yet. In LevelUp, open a task, choose <b>Hand off</b>, then <b>Send to the Fleet</b>. It appears here within a minute with a proposed plan for you to approve.
        </div>
      )}
      {groups.filter((g) => g.items.length).map((g) => (
        <div key={g.title} className="flex flex-col gap-2">
          <p className="flex items-center gap-2 text-[13px] font-semibold text-ink"><span className="inline-block h-2 w-2 rounded-full" style={{ background: g.color }} /> {g.title} <span className="font-normal text-ink-faint">{g.items.length}</span>{g.hint && <span className="font-normal text-ink-faint">· {g.hint}</span>}</p>
          <div className="grid gap-3 lg:grid-cols-2">
            {g.items.map((t) => (
              <div key={t.id} className="panel flex flex-col gap-1.5 p-4">
                <p className="text-[11px] text-ink-faint">{t.area ?? "No area"}{t.when ? ` · starts ${t.when}` : ""}</p>
                <p className="text-[14px] font-semibold text-ink">{t.title}</p>
                <p className="text-[12px] text-ink-dim">{who(t)}{t.assignee.kind === "machine" ? ` · ${t.assignee.folder === "~" ? "home folder" : t.assignee.folder}` : ""} · {t.access === "edit" ? "may change files once approved" : "answer only"}</p>
                {t.assignReason && g.title === "Needs your approval" && <p className="text-[11px] text-ink-faint">Why there: {t.assignReason}</p>}
                {t.result && (g.title !== "In progress") && (
                  <div className="max-h-56 overflow-y-auto rounded-lg border border-line px-3 py-2 text-[12px]">
                    {t.result.error ? <span style={{ color: "var(--ac-rose)" }}>Didn&apos;t finish: {t.result.error}</span> : <Markdown>{t.result.text || "(no text)"}</Markdown>}
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {g.title === "Needs your approval" && <button type="button" className={primary} style={{ background: "var(--ac-violet)" }} disabled={busy === `ap-${t.id}`} onClick={() => void act(`ap-${t.id}`, { action: "approve", id: t.id }, "Approved: it starts within a minute, or on its day.")}>Approve</button>}
                  {g.title === "Ready for your review" && <button type="button" className={primary} style={{ background: "var(--ac-violet)" }} disabled={busy === `ok-${t.id}`} onClick={() => void act(`ok-${t.id}`, { action: "update", id: t.id, status: "done" }, "Accepted. LevelUp is told within a minute.")}>Accept</button>}
                  {t.result?.key && <Link href={`/projects?session=${encodeURIComponent(t.result.key)}`} className="text-[11px] text-ink-faint underline">open the session</Link>}
                  <span className="ml-auto text-[11px] text-ink-faint">{t.history?.length ? t.history[t.history.length - 1].what : ""}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
