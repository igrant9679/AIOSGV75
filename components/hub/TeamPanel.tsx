"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Panel from "../ui/Panel";
import Markdown from "../Markdown";
import { ACCENTS } from "@/lib/accents";
import type { HubSnapshot } from "@/lib/activity";
import type { TeamMember, TeamMessage } from "@/lib/team";
import { toolLabel } from "@/lib/sessionTools";
import { ago } from "./common";
import { SmallButton, parseToolChoice, toolChoices } from "./SessionPanel";

interface Progress {
  status: string;
  text: string;
  steps: string[];
  waitReason?: string;
  hostLabel: string;
}
interface TeamView {
  members: TeamMember[];
  messages: TeamMessage[];
  progress: Record<string, Progress>;
  error?: string;
}

const post = async (body: object): Promise<{ error?: string }> => {
  try {
    const r = await fetch("/api/hub/team", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return await r.json();
  } catch (e) {
    return { error: (e as Error).message };
  }
};

const memberTool = (m: TeamMember) => (m.tool === "acp" ? m.agentLabel || "ACP agent" : toolLabel(m.tool));
const ACCENT_CYCLE = ["violet", "lime", "amber", "cyan", "magenta", "rose"] as const;

/**
 * Command → Team (lib/team.ts): named teammates with roles, each in a real session of its own, in one
 * channel. "@Name" sends a message; a teammate's "@Other: task" line hands work on.
 */
export default function TeamPanel({ hub }: { hub: HubSnapshot | null }) {
  const [view, setView] = useState<TeamView | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<Partial<TeamMember> | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    fetch("/api/hub/team")
      .then((r) => r.json())
      .then((b: TeamView) => (b.error ? setErr(b.error) : setView(b)))
      .catch(() => {});
  }, []);
  const inFlight = view?.messages.some((m) => m.status === "waiting" || m.status === "working");
  useEffect(() => {
    load();
    const t = setInterval(load, inFlight ? 3_000 : 20_000);
    return () => clearInterval(t);
  }, [load, inFlight]);
  const count = view?.messages.length ?? 0;
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [count]);

  const members = view?.members ?? [];
  const accentOf = (id: string) => ACCENTS[ACCENT_CYCLE[Math.max(0, members.findIndex((m) => m.id === id)) % ACCENT_CYCLE.length]].base;
  const nameOf = (id?: string) => members.find((m) => m.id === id)?.name ?? "a removed teammate";

  const send = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setErr(null);
    const r = await post({ action: "post", text: text.trim() });
    setBusy(false);
    if (r.error) setErr(r.error);
    else setText("");
    load();
  };

  return (
    <Panel title="Team" right={members.length ? <span className="font-mono text-[10px] text-ink-faint">{members.length} teammates</span> : undefined}>
      <div className="flex flex-col gap-3 p-4">
        <p className="text-[10px] leading-4 text-ink-faint">
          Named AI teammates, each with a role, a tool, a machine and a project folder, each working in a real session of its own. Write <b>@Name</b> to give one a task; a teammate whose reply ends with a line like <code>@Linus: review session.ts</code> hands work on. Messages wait until a teammate is free, a teammate whose plan hits its limit carries on with the next tool (same role), and a chain of hand-offs stops after 6 without you. Hand-offs are held while the fleet is paused.
        </p>

        {/* teammates */}
        <div className="flex flex-wrap gap-2">
          {members.map((m) => {
            const busyNow = view?.messages.some((x) => x.to === m.id && (x.status === "waiting" || x.status === "working"));
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setEditing(m)}
                title={`${m.role}\n\n${memberTool(m)} on ${m.hostLabel}, in ${m.folder}${m.sessionKey ? "\nHas a session" : "\nNo session yet"}\nClick to edit`}
                className="flex cursor-pointer items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 text-left hover:bg-white/[0.04]"
              >
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: accentOf(m.id), boxShadow: busyNow ? `0 0 8px ${accentOf(m.id)}` : undefined }} />
                <span className="text-xs font-semibold text-ink">{m.name}</span>
                <span className="font-mono text-[10px] text-ink-faint">
                  {memberTool(m)} · {m.hostLabel}
                  {busyNow ? " · busy" : ""}
                </span>
              </button>
            );
          })}
          <SmallButton accent onClick={() => setEditing({ access: "answer", tool: "claude", host: hub?.host, folder: "~" })}>
            + teammate
          </SmallButton>
        </div>

        {editing && <MemberForm hub={hub} initial={editing} onClose={() => setEditing(null)} onSaved={load} />}

        {/* channel */}
        <div ref={box} className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto rounded-lg bg-white/[0.02] p-2">
          {!view?.messages.length && <p className="p-2 font-mono text-[10px] text-ink-faint">{members.length ? `Nothing yet. Try "@${members[0].name} …".` : "Add a teammate to start."}</p>}
          {view?.messages.slice(-80).map((m) => {
            if (m.from === "system") {
              if (m.jobId && (m.status === "waiting" || m.status === "working")) {
                const p = view.progress[m.jobId];
                return (
                  <div key={m.id} className="flex flex-col gap-1 rounded-md px-2 py-1 font-mono text-[10px]" style={{ color: ACCENTS.cyan.base }}>
                    <span>
                      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: ACCENTS.cyan.base }} /> {nameOf(m.to)}{" "}
                      {p?.status === "running" ? `is working${p.hostLabel ? ` on ${p.hostLabel}` : ""}…` : p?.waitReason ? `has your message, waiting for ${p.waitReason}` : "has your message…"}
                    </span>
                    {p?.steps.length ? <span className="truncate text-ink-faint">▸ {p.steps[p.steps.length - 1]}</span> : null}
                  </div>
                );
              }
              if (!m.text) return null;
              return (
                <p key={m.id} className="px-2 font-mono text-[10px]" style={{ color: m.status === "error" ? ACCENTS.rose.base : ACCENTS.amber.base }}>
                  {m.text}
                </p>
              );
            }
            const you = m.from === "you";
            return (
              <div key={m.id} className={`flex flex-col gap-0.5 rounded-lg px-2.5 py-1.5 ${you ? "bg-white/[0.04]" : ""}`}>
                <p className="font-mono text-[10px]">
                  <span className="font-semibold" style={{ color: you ? "var(--page-accent)" : accentOf(m.from) }}>
                    {you ? "You" : nameOf(m.from)}
                  </span>
                  <span className="text-ink-faint"> · {ago(m.ts)} ago</span>
                </p>
                <div className="max-h-[40vh] overflow-y-auto text-xs">
                  <Markdown>{m.text || "(no text reply)"}</Markdown>
                </div>
              </div>
            );
          })}
        </div>

        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void send();
              }
            }}
            rows={2}
            placeholder={members.length ? `@${members[0].name} what you need…` : "Add a teammate first"}
            aria-label="Message the team"
            className="min-h-[56px] w-full resize-y rounded-lg border border-line bg-transparent px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-line-bright"
          />
          <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px] text-ink-dim">
            {members.map((m) => (
              <SmallButton key={m.id} onClick={() => setText((t) => `${t}${t && !t.endsWith(" ") ? " " : ""}@${m.name} `)}>
                @{m.name}
              </SmallButton>
            ))}
            <span className="flex-1" />
            {count > 0 && (
              <SmallButton onClick={() => void post({ action: "clear" }).then(load)} title="Clear finished messages from the channel (the teammates' sessions are kept)">
                Clear
              </SmallButton>
            )}
            <span className="text-ink-faint">Ctrl+Enter</span>
            <button
              type="submit"
              disabled={busy || !text.trim() || !members.length}
              className="cursor-pointer rounded-md border px-3 py-1 font-mono text-[11px] font-semibold transition-colors hover:bg-white/[0.06] disabled:cursor-default disabled:opacity-40"
              style={{ borderColor: "var(--page-accent)", color: "var(--page-accent)" }}
            >
              {busy ? "Sending…" : "Send"}
            </button>
          </div>
          {err && (
            <p className="text-[11px]" style={{ color: ACCENTS.rose.base }}>
              {err}
            </p>
          )}
        </form>
      </div>
    </Panel>
  );
}

function MemberForm({ hub, initial, onClose, onSaved }: { hub: HubSnapshot | null; initial: Partial<TeamMember>; onClose: () => void; onSaved: () => void }) {
  const [m, setM] = useState<Partial<TeamMember>>(initial);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const host = m.host || hub?.host || "";
  const machines = useMemo(() => [{ host: hub?.host ?? "", label: "This machine" }, ...(hub?.machines ?? []).filter((x) => !x.stale && x.acceptsReplies !== "off").map((x) => ({ host: x.host, label: x.label }))], [hub]);
  const folders = useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of hub?.sessions ?? []) if (s.host === host && s.folder && !seen.has(s.folder)) seen.set(s.folder, s.project);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [hub, host]);
  const choices = toolChoices(hub, host);
  const choice = m.tool === "acp" ? `acp:${m.agent}` : (m.tool ?? "claude");
  const remote = machines.find((x) => x.host === host && x.host !== hub?.host);
  const level = remote ? hub?.machines.find((x) => x.host === host)?.acceptsReplies : "edit";
  const inp = "rounded-md border border-line bg-transparent px-2 py-1 font-mono text-[10px] text-ink outline-none";

  const save = async () => {
    setBusy(true);
    setErr(null);
    const label = choices.find((c) => c.value === choice)?.label.replace(/ \(ACP\)$/, "");
    const r = await post({ action: "member", member: { ...m, host, hostLabel: machines.find((x) => x.host === host)?.label, agentLabel: m.tool === "acp" ? label : undefined, project: m.folder === "~" ? undefined : folders.find(([f]) => f === m.folder)?.[1] } });
    setBusy(false);
    if (r.error) return setErr(r.error);
    onSaved();
    onClose();
  };

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line p-3">
      <div className="flex flex-wrap items-center gap-2">
        <input value={m.name ?? ""} onChange={(e) => setM({ ...m, name: e.target.value })} placeholder="Name (one word)" aria-label="Name" className={inp} />
        <select
          value={choice}
          onChange={(e) => {
            const p = parseToolChoice(e.target.value);
            setM({ ...m, tool: p.tool, agent: p.agent });
          }}
          aria-label="Tool"
          className={inp}
        >
          {choices.map((c) => (
            <option key={c.value} value={c.value} style={{ background: "var(--color-panel)" }}>
              {c.label}
            </option>
          ))}
        </select>
        <select value={host} onChange={(e) => setM({ ...m, host: e.target.value, folder: "~" })} aria-label="Machine" className={inp}>
          {machines.map((x) => (
            <option key={x.host} value={x.host} style={{ background: "var(--color-panel)" }}>
              {x.label}
            </option>
          ))}
        </select>
        <select value={m.folder ?? "~"} onChange={(e) => setM({ ...m, folder: e.target.value })} aria-label="Project folder" className={`${inp} max-w-[220px]`}>
          <option value="~" style={{ background: "var(--color-panel)" }}>
            Home folder
          </option>
          {folders.map(([f, p]) => (
            <option key={f} value={f} style={{ background: "var(--color-panel)" }}>
              {p}
            </option>
          ))}
        </select>
        <select value={m.access ?? "answer"} onChange={(e) => setM({ ...m, access: e.target.value === "edit" ? "edit" : "answer" })} aria-label="What it may do" className={inp}>
          <option value="answer" style={{ background: "var(--color-panel)" }}>
            Answer only
          </option>
          <option value="edit" disabled={level !== "edit"} style={{ background: "var(--color-panel)" }}>
            Can edit files{level === "edit" ? "" : " (not allowed there)"}
          </option>
        </select>
      </div>
      <textarea
        value={m.role ?? ""}
        onChange={(e) => setM({ ...m, role: e.target.value })}
        rows={3}
        placeholder="Role and instructions, e.g. 'Reviewer. Read the change and the tests; say what's wrong and why. Don't edit files.'"
        aria-label="Role"
        className="w-full resize-y rounded-lg border border-line bg-transparent px-3 py-2 text-xs text-ink outline-none placeholder:text-ink-faint"
      />
      <div className="flex flex-wrap items-center gap-2">
        <SmallButton accent onClick={() => void save()} disabled={busy}>
          {busy ? "Saving…" : initial.id ? "Save" : "Add teammate"}
        </SmallButton>
        <SmallButton onClick={onClose}>Cancel</SmallButton>
        {initial.id && (
          <>
            <span className="flex-1" />
            {initial.sessionKey && (
              <SmallButton onClick={() => void post({ action: "reset", id: initial.id }).then(onSaved).then(onClose)} title="Its next message starts a new session (with its role again)">
                New session
              </SmallButton>
            )}
            <SmallButton onClick={() => void post({ action: "remove", id: initial.id }).then(onSaved).then(onClose)} title="Remove from the team (its sessions are kept)">
              Remove
            </SmallButton>
          </>
        )}
      </div>
      <p className="text-[10px] leading-4 text-ink-faint">Changing the tool, machine or folder starts the teammate in a new session there; its old session stays on the Projects page.</p>
      {err && (
        <p className="text-[11px]" style={{ color: ACCENTS.rose.base }}>
          {err}
        </p>
      )}
    </div>
  );
}
