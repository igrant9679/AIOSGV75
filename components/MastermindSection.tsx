"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ACCENTS, type Accent } from "@/lib/accents";
import type { MastermindChat } from "@/lib/mastermind";
import Panel from "./ui/Panel";
import StatusOrb from "./ui/StatusOrb";
import EmptyState from "./ui/EmptyState";
import Avatar from "./Avatar";
import Markdown from "./Markdown";
import MicButton from "./MicButton";
import { IconTrash, IconPlus } from "./icons";
import { useMission } from "./store";

interface ChatMeta {
  id: string;
  title: string;
  roomIds: string[];
  status: "idle" | "running";
  speaking?: string;
  updatedAt: number;
  turnCount: number;
}

function ago(ts: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export default function MastermindSection() {
  const { agents, registry, system } = useMission();
  const [chats, setChats] = useState<ChatMeta[]>([]);
  const [active, setActive] = useState<MastermindChat | null>(null);
  const [room, setRoom] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [err, setErr] = useState("");
  const threadRef = useRef<HTMLDivElement>(null);

  const roster = useMemo(() => {
    const list: { id: string; name: string; accent: Accent; ready: boolean }[] = [
      { id: "claude", name: "Claude", accent: "violet", ready: Boolean(system?.claudeVersion) },
      ...agents.map((a) => ({ id: a.id, name: a.name, accent: a.accent, ready: a.available })),
      ...registry.llms.map((l) => ({ id: l.id, name: l.name, accent: l.accent, ready: l.hasKey })),
      ...registry.commandAgents.map((c) => ({ id: c.id, name: c.name, accent: c.accent, ready: true })),
    ];
    return list;
  }, [agents, registry, system]);

  const names = useMemo(() => Object.fromEntries(roster.map((r) => [r.id, r.name])), [roster]);
  const accents = useMemo(() => Object.fromEntries(roster.map((r) => [r.id, r.accent])), [roster]) as Record<string, Accent>;

  // default room: everything that's ready
  useEffect(() => {
    if (room.length === 0 && roster.some((r) => r.ready)) {
      setRoom(roster.filter((r) => r.ready).map((r) => r.id).slice(0, 8));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roster.map((r) => `${r.id}${r.ready}`).join()]);

  const loadChats = useCallback(async () => {
    try {
      const res = await fetch("/api/mastermind");
      if (res.ok) setChats(((await res.json()) as { chats: ChatMeta[] }).chats ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  const loadActive = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/mastermind?id=${encodeURIComponent(id)}`);
      if (res.ok) {
        const chat = ((await res.json()) as { chat: MastermindChat }).chat;
        setActive(chat);
        setTimeout(() => threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" }), 60);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    loadChats();
  }, [loadChats]);

  // poll fast while a round is running
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => {
      loadActive(active.id);
      loadChats();
    }, active.status === "running" ? 2_500 : 12_000);
    return () => clearInterval(t);
  }, [active?.id, active?.status, loadActive, loadChats]);

  const send = async () => {
    const message = draft.trim();
    if (!message) return;
    setErr("");
    setDraft("");
    const body = active ? { chatId: active.id, message } : { message, roomIds: room };
    const res = await fetch("/api/mastermind", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { ok?: boolean; id?: string; error?: string };
    if (!res.ok || !json.ok) {
      setErr(json.error ?? "send failed");
      setDraft(message);
      return;
    }
    if (json.id) await loadActive(json.id);
    loadChats();
  };

  const roomLocked = Boolean(active);
  const displayedRoom = active?.roomIds ?? room;

  return (
    <div className="flex flex-col gap-4">
      <Panel title="AI Agent Mastermind">
        <div className="flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-xl text-[12px] leading-5 text-ink-dim">
              One room, every agent — each a <span className="font-semibold text-ink">different real model</span>. They reply in turn,
              read the shared brain, and riff off each other. Tag <span className="font-mono text-neon-cyan">@claude</span> (or any
              agent) to ask just them.
            </p>
            <button
              onClick={() => {
                setActive(null);
                setErr("");
              }}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs text-ink-dim transition-colors hover:bg-white/[0.06]"
            >
              <IconPlus width={13} height={13} /> New chat
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="pr-1 font-mono text-[10px] tracking-[0.12em] text-ink-faint">IN THE ROOM</span>
            {roster.map((r) => {
              const inRoom = displayedRoom.includes(r.id);
              return (
                <button
                  key={r.id}
                  disabled={roomLocked || !r.ready}
                  onClick={() =>
                    setRoom((cur) => (cur.includes(r.id) ? cur.filter((x) => x !== r.id) : cur.length < 8 ? [...cur, r.id] : cur))
                  }
                  title={r.ready ? undefined : "offline on this machine"}
                  className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] tracking-[0.06em] transition-colors disabled:cursor-default"
                  style={
                    inRoom
                      ? { background: ACCENTS[r.accent].soft, color: ACCENTS[r.accent].base, borderColor: "transparent", opacity: 1 }
                      : { borderColor: "var(--color-line)", color: "var(--color-ink-faint)", opacity: r.ready ? 1 : 0.4 }
                  }
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: r.ready ? ACCENTS[r.accent].base : "var(--color-line)" }} />
                  {r.name}
                </button>
              );
            })}
            <span className="font-mono text-[10px] text-ink-faint">· {displayedRoom.length} seats</span>
          </div>
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[1fr_280px]">
        <Panel
          title={active ? active.title : "New round table"}
          right={
            active?.status === "running" ? (
              <span className="flex items-center gap-2 font-mono text-[10px] text-neon-amber">
                <StatusOrb accent="amber" pulsing size={7} />
                {names[active.speaking ?? ""] ?? "someone"} is thinking…
              </span>
            ) : undefined
          }
          delay={0.06}
        >
          <div className="flex h-[560px] flex-col">
            <div ref={threadRef} className="flex-1 space-y-4 overflow-y-auto p-4">
              {!active && (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                  <div className="flex -space-x-2">
                    {displayedRoom.slice(0, 8).map((id) => (
                      <Avatar key={id} name={names[id]} accent={accents[id]} size={34} />
                    ))}
                  </div>
                  <p className="pt-2 text-sm text-ink-dim">Drop a question and watch them go.</p>
                  <p className="text-[11px] text-ink-faint">
                    &quot;What should I build next in Mission Control?&quot; · &quot;@codex how would you structure this?&quot;
                  </p>
                </div>
              )}
              {active?.turns.map((t, i) =>
                t.role === "user" ? (
                  <div key={i} className="flex justify-end">
                    <div className="max-w-[80%] rounded-2xl rounded-br-md border border-line bg-white/[0.04] px-4 py-2.5">
                      <p className="pb-0.5 text-right font-mono text-[9px] tracking-[0.16em] text-ink-faint">YOU</p>
                      <p className="whitespace-pre-wrap text-sm text-ink">{t.text}</p>
                    </div>
                  </div>
                ) : (
                  <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex gap-3">
                    <Avatar name={names[t.agentId ?? ""] ?? t.agentId} accent={accents[t.agentId ?? ""] ?? "cyan"} size={30} />
                    <div className="min-w-0 max-w-[85%] rounded-2xl rounded-tl-md border border-line bg-white/[0.02] px-4 py-2.5">
                      <p className="pb-1 font-mono text-[9px] tracking-[0.16em]" style={{ color: ACCENTS[accents[t.agentId ?? ""] ?? "cyan"].base }}>
                        {(names[t.agentId ?? ""] ?? t.agentId ?? "").toUpperCase()}
                      </p>
                      {t.error ? (
                        <p className="font-mono text-[11px] text-neon-rose">errored: {t.error.slice(0, 160)}</p>
                      ) : (
                        <Markdown>{t.text}</Markdown>
                      )}
                    </div>
                  </motion.div>
                )
              )}
              {active?.status === "running" && (
                <div className="flex items-center gap-2 pl-10 font-mono text-[10px] text-ink-faint">
                  <StatusOrb accent={accents[active.speaking ?? ""] ?? "amber"} pulsing size={6} />
                  {names[active.speaking ?? ""] ?? "…"} is composing
                </div>
              )}
            </div>
            {err && <p className="mx-4 mb-2 rounded-lg border border-neon-rose/30 bg-neon-rose/10 px-3 py-1.5 font-mono text-[11px] text-neon-rose">{err}</p>}
            <div className="flex items-end gap-2 border-t border-line p-3">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                rows={2}
                placeholder={`Message the room… (tag @${displayedRoom[0] ?? "claude"} to ask one)`}
                className="min-h-12 w-full resize-none rounded-xl border border-line bg-panel-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-line-bright"
              />
              <MicButton onFinal={(t) => setDraft((d) => (d ? `${d} ${t}` : t))} />
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={send}
                disabled={!draft.trim() || active?.status === "running" || (!active && displayedRoom.length < 2)}
                className="cursor-pointer rounded-xl bg-gradient-to-br from-cyan-600 to-neon-cyan px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-35"
              >
                Send
              </motion.button>
            </div>
          </div>
        </Panel>

        <Panel title="History" right={<span className="font-mono text-[11px] text-ink-faint">{chats.length}</span>} delay={0.1}>
          <div className="flex max-h-[560px] flex-col gap-1.5 overflow-y-auto p-3">
            {chats.length === 0 && <EmptyState compact accent="cyan" title="No sessions" hint="Start a room above — every mastermind is archived here." />}
            {chats.map((c) => (
              <div
                key={c.id}
                className="group flex cursor-pointer items-center gap-2 rounded-xl border border-line bg-white/[0.02] px-3 py-2 transition-colors hover:border-line-bright"
                style={active?.id === c.id ? { borderColor: ACCENTS.cyan.base } : undefined}
                onClick={() => loadActive(c.id)}
              >
                <StatusOrb accent={c.status === "running" ? "amber" : "cyan"} pulsing={c.status === "running"} size={7} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold text-ink">{c.title}</span>
                  <span className="font-mono text-[10px] text-ink-faint">
                    {c.roomIds.length} agents · {c.turnCount} turns · {ago(c.updatedAt)}
                  </span>
                </span>
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    await fetch(`/api/mastermind?id=${encodeURIComponent(c.id)}`, { method: "DELETE" });
                    if (active?.id === c.id) setActive(null);
                    loadChats();
                  }}
                  aria-label={`Delete ${c.title}`}
                  className="cursor-pointer rounded p-1 text-ink-faint opacity-0 transition-opacity hover:text-neon-rose group-hover:opacity-100"
                >
                  <IconTrash width={12} height={12} />
                </button>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
