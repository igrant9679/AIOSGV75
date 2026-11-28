"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Markdown from "./Markdown";
import { useMission } from "./store";
import { useNetSettings } from "./useNetSettings";
import { hubRoute, type HubRoute } from "@/lib/hubRoute";
import type { Board } from "@/lib/board";

/**
 * The Hub (rule 49): one box for everything. Auto decides where a request goes and says so:
 *   Fleet → Mission Control answers from the whole fleet, or proposes a change as a confirm card
 *   Agent → a real session on a machine (pick the tool, the machine or let it choose, and what it may do)
 *   Chat  → an answer from the best available model, or the engine you pick
 * Below it: your engines and machines, wired in, live.
 */

type Mode = "auto" | HubRoute;
type Tier = "auto" | "fast" | "balanced" | "best";
interface Turn { who: "you" | "mc"; text: string; via?: string; card?: { id: string; text: string; state?: string }; job?: { id: string; machine: string; status: string; key?: string } }
interface Candidate { host: string; label: string; ok: boolean; folder?: string; reasons: string[]; blocked?: string }

const TIER_MODEL: Record<Exclude<Tier, "auto">, string> = { fast: "haiku", balanced: "sonnet", best: "opus" };
const post = async (url: string, body: unknown, method = "POST") => (await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();

function Seg<T extends string>({ label, value, options, onPick }: { label: string; value: T; options: { v: T; l: string; title?: string; off?: boolean }[]; onPick: (v: T) => void }) {
  return (
    <span className="flex items-center gap-2">
      <span className="text-[12px] text-ink-faint">{label}</span>
      <span className="studio-seg" style={{ display: "inline-flex" }} role="group" aria-label={label}>
        {options.map((o) => (
          <button key={o.v} type="button" aria-pressed={value === o.v} disabled={o.off} title={o.title} onClick={() => onPick(o.v)} style={o.off ? { opacity: 0.4, cursor: "not-allowed" } : undefined}>
            {o.l}
          </button>
        ))}
      </span>
    </span>
  );
}

export default function HubSection() {
  const net = useNetSettings();
  const { system, agents, registry } = useMission();
  const [text, setText] = useState("");
  const [mode, setMode] = useState<Mode>("auto");
  const [engine, setEngine] = useState("auto");
  const [tier, setTier] = useState<Tier>("auto");
  const [tool, setTool] = useState("claude");
  const [machine, setMachine] = useState("auto");
  const [access, setAccess] = useState<"answer" | "edit">("answer");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [board, setBoard] = useState<Board | null>(null);
  const [cands, setCands] = useState<Candidate[]>([]);
  const feed = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    const load = () => fetch("/api/board").then((r) => r.json()).then((b) => live && b.items && setBoard(b)).catch(() => {});
    load();
    const t = setInterval(load, 15_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);
  useEffect(() => {
    fetch(`/api/hub/dispatch?tool=${tool}`).then((r) => r.json()).then((j) => setCands(j.candidates ?? [])).catch(() => {});
  }, [tool]);
  useEffect(() => {
    feed.current?.scrollTo({ top: feed.current.scrollHeight, behavior: "smooth" });
  }, [turns, busy]);

  const guess = useMemo(() => hubRoute(text), [text]);
  const route: HubRoute = mode === "auto" ? guess.route : mode;
  const chatEngines = useMemo(
    () => [
      { v: "auto", l: "Auto" },
      { v: "claude", l: "Claude", off: !system?.claudeVersion },
      ...agents.filter((a) => a.id !== "claude").map((a) => ({ v: a.id, l: a.name, off: !a.available })),
      ...registry.llms.map((l) => ({ v: l.id, l: l.name, off: !l.hasKey })),
    ],
    [system, agents, registry],
  );
  const push = (t: Turn) => setTurns((x) => [...x, t]);
  const patchLast = (fn: (t: Turn) => Turn) => setTurns((x) => (x.length ? [...x.slice(0, -1), fn(x[x.length - 1])] : x));

  const followJob = useCallback(async (id: string) => {
    for (let i = 0; i < 400; i++) {
      await new Promise((r) => setTimeout(r, 4000));
      try {
        const j = await (await fetch("/api/hub/sessions")).json();
        const job = (j.jobs ?? []).find((x: { id: string }) => x.id === id);
        if (!job) continue;
        if (["done", "error", "expired"].includes(job.status)) {
          setTurns((x) => x.map((t) => (t.job?.id === id ? { ...t, text: job.status === "done" ? job.reply || "(finished, no text reply)" : `It didn't finish: ${job.error ?? job.status}`, job: { ...t.job!, status: job.status, key: job.resultKey } } : t)));
          return;
        }
        setTurns((x) => x.map((t) => (t.job?.id === id ? { ...t, job: { ...t.job!, status: job.status }, text: job.progress?.text ? `Working… ${String(job.progress.text).slice(-160)}` : t.text } : t)));
      } catch {
        /* next round */
      }
    }
  }, []);

  const send = async () => {
    const q = text.trim();
    if (!q || busy) return;
    setText("");
    push({ who: "you", text: q });
    setBusy(true);
    const history = turns.slice(-6).map((t) => ({ who: t.who === "you" ? "owner" : "mission control", text: t.text, role: t.who === "you" ? "user" : "assistant", content: t.text }));
    try {
      if (route === "fleet") {
        const r = await post("/api/talos", { op: "command", text: q, history });
        push({ who: "mc", text: r.error ? `I couldn't do that: ${r.error}` : (r.say ?? ""), via: "Mission Control", card: r.card });
      } else if (route === "chat") {
        const r = await post("/api/auto", { prompt: q, history: history.map((h) => ({ role: h.role, content: h.content })), agent: engine });
        push({ who: "mc", text: r.error ? `That didn't work: ${r.error}` : (r.text ?? "No response."), via: r.routedTo ? `answered by ${r.routedTo}${r.reason ? ` (${r.reason})` : ""}` : undefined });
      } else {
        const pick = machine === "auto" ? cands.find((c) => c.ok) : cands.find((c) => c.host === machine);
        if (!pick) throw new Error("No machine can take it right now (see Fleet).");
        const r = await post("/api/hub/sessions", { action: "new", host: pick.host, folder: pick.folder ?? "~", tool, prompt: q, access, model: tool === "claude" && tier !== "auto" ? TIER_MODEL[tier] : undefined });
        const job = r.job ?? r;
        if (r.error || job?.status === "error") throw new Error(r.error ?? job?.error ?? "It couldn't be started.");
        push({ who: "mc", text: `Started on ${pick.label}${machine === "auto" ? ` (${pick.reasons.slice(0, 2).join(", ")})` : ""}.`, via: `${tool === "claude" ? "Claude Code" : tool} · ${access === "edit" ? "may change files" : "answer only"}`, job: { id: job.id, machine: pick.label, status: job.status } });
        void followJob(job.id);
      }
    } catch (e) {
      push({ who: "mc", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const answerCard = async (id: string, reply: "yes" | "no") => {
    const r = await post("/api/talos", { op: "confirm", id, reply });
    setTurns((x) => x.map((t) => (t.card?.id === id ? { ...t, card: { ...t.card, state: r.error ? `failed: ${r.error}` : r.status === "done" ? "done" : r.status === "failed" ? `failed: ${r.error ?? ""}` : (r.status ?? "cancelled") } } : t)));
  };
  void patchLast;

  const c = board?.counts;
  const first = (net?.ownerName || "").split(" ")[0];
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3 pt-2">
        <h2 className="text-2xl font-bold tracking-tight text-ink">Welcome back{first ? `, ${first}` : ""}</h2>
        <span className="flex-1" />
        {c && c.waiting > 0 && (
          <Link href="/city" className="studio-chip" style={{ display: "inline-flex", borderColor: "color-mix(in srgb, var(--ac-amber) 50%, transparent)", color: "var(--ac-amber)" }}>
            <b>{c.waiting}</b> wait{c.waiting === 1 ? "s" : ""} for you
          </Link>
        )}
        <Link href="/city" className="studio-chip" style={{ display: "inline-flex" }}>
          Board
        </Link>
        <Link href="/fleet" className="studio-chip" style={{ display: "inline-flex" }}>
          Fleet
        </Link>
      </div>

      <div className="panel flex flex-col gap-3 p-4">
        <p className="text-[15px] font-semibold text-ink">Ask Mission Control</p>
        {turns.length > 0 && (
          <div ref={feed} className="flex max-h-[46vh] flex-col gap-2 overflow-y-auto pr-1">
            {turns.map((t, i) => (
              <div key={i} className={`max-w-[88%] rounded-xl border border-line px-3 py-2 ${t.who === "you" ? "self-end" : "self-start"}`} style={t.who === "you" ? { background: "var(--surface-panel-2)" } : undefined}>
                {t.via && <p className="pb-0.5 text-[11px] text-ink-faint">{t.via}</p>}
                <div className="text-[13px] leading-6 text-ink">{t.who === "mc" ? <Markdown>{t.text || "…"}</Markdown> : t.text}</div>
                {t.card && (
                  <div className="mt-2 rounded-lg border px-3 py-2" style={{ borderColor: "color-mix(in srgb, var(--ac-amber) 45%, transparent)" }}>
                    <p className="whitespace-pre-wrap text-[12px] text-ink-dim">{t.card.text}</p>
                    {t.card.state ? (
                      <p className="pt-1 text-[12px] font-semibold" style={{ color: t.card.state === "done" ? "var(--ac-lime)" : "var(--ac-rose)" }}>{t.card.state === "done" ? "Done." : t.card.state}</p>
                    ) : (
                      <div className="flex gap-2 pt-2">
                        <button type="button" onClick={() => void answerCard(t.card!.id, "yes")} className="cursor-pointer rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white" style={{ background: "var(--ac-violet)" }}>
                          Yes, run it
                        </button>
                        <button type="button" onClick={() => void answerCard(t.card!.id, "no")} className="cursor-pointer rounded-lg border border-line px-3 py-1.5 text-[12px] text-ink-dim">
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                )}
                {t.job && (
                  <p className="pt-1 text-[11px] text-ink-faint">
                    {t.job.status === "done" ? "Finished" : t.job.status === "error" ? "Stopped" : `${t.job.status}…`} on {t.job.machine}
                    {t.job.key && (
                      <>
                        {" · "}
                        <Link href={`/projects?session=${encodeURIComponent(t.job.key)}`} className="underline">
                          open the session
                        </Link>
                      </>
                    )}
                  </p>
                )}
              </div>
            ))}
            {busy && <p className="self-start text-[12px] text-ink-faint">Working…</p>}
          </div>
        )}
        <div className="rounded-xl border border-line p-3 focus-within:border-[color:var(--ac-violet)]">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={2}
            placeholder="Ask anything, or give it a job. Enter sends, Shift and Enter adds a line."
            aria-label="Ask Mission Control"
            className="w-full resize-none bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-faint"
          />
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <span className="studio-seg" style={{ display: "inline-flex" }} role="group" aria-label="Where it goes">
              {(
                [
                  ["auto", "Auto", "Mission Control picks: Fleet, Agent or Chat"],
                  ["fleet", "Fleet", "Ask about, or control, your machines and their work"],
                  ["agent", "Agent", "A real session on a machine: it can read and (if you allow) change files"],
                  ["chat", "Chat", "An answer from a model"],
                ] as const
              ).map(([v, l, title]) => (
                <button key={v} type="button" aria-pressed={mode === v} title={title} onClick={() => setMode(v)}>
                  {l}
                </button>
              ))}
            </span>
            {mode === "auto" && text.trim() && (
              <span className="text-[12px] text-ink-faint">
                → <b className="text-ink-dim">{route === "fleet" ? "Fleet" : route === "agent" ? "Agent" : "Chat"}</b>: {guess.why}
              </span>
            )}
            <span className="flex-1" />
            <button type="button" onClick={() => void send()} disabled={busy || !text.trim()} className="cursor-pointer rounded-lg px-3.5 py-1.5 text-[13px] font-semibold text-white disabled:opacity-40" style={{ background: "var(--ac-violet)" }}>
              Send ↵
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {route === "chat" && <Seg label="Engine" value={engine} options={chatEngines} onPick={setEngine} />}
          {route === "agent" && (
            <>
              <Seg label="Tool" value={tool} options={[{ v: "claude", l: "Claude Code" }, { v: "codex", l: "Codex" }, { v: "hermes", l: "Hermes" }]} onPick={setTool} />
              <span className="flex items-center gap-2">
                <span className="text-[12px] text-ink-faint">Machine</span>
                <select value={machine} onChange={(e) => setMachine(e.target.value)} aria-label="Machine" className="h-8 rounded-lg border border-line bg-transparent px-2 text-[12px] text-ink">
                  <option value="auto" style={{ background: "var(--color-panel)" }}>Auto{cands.find((x) => x.ok) ? ` (${cands.find((x) => x.ok)!.label})` : ""}</option>
                  {cands.map((x) => (
                    <option key={x.host} value={x.host} disabled={!x.ok} style={{ background: "var(--color-panel)" }}>
                      {x.label}{x.ok ? ` · ${x.reasons[0] ?? ""}` : ` · ${x.blocked ?? "can't take it"}`}
                    </option>
                  ))}
                </select>
              </span>
              <Seg label="It may" value={access} options={[{ v: "answer", l: "Answer only" }, { v: "edit", l: "Change files" }]} onPick={setAccess} />
              {tool === "claude" && <Seg label="Model" value={tier} options={[{ v: "auto", l: "Auto" }, { v: "fast", l: "Fast" }, { v: "balanced", l: "Balanced" }, { v: "best", l: "Best" }]} onPick={setTier} />}
            </>
          )}
          {route === "fleet" && <span className="text-[12px] text-ink-faint">Answers come from a fresh picture of all your machines. A change is shown as a card first: nothing runs until you say yes.</span>}
        </div>
      </div>

      <Wiring board={board} engines={chatEngines.filter((e) => e.v !== "auto")} />
    </div>
  );
}

/** Engines on the left, Mission Control in the middle, your machines on the right, joined by live lines. */
function Wiring({ board, engines }: { board: Board | null; engines: { v: string; l: string; off?: boolean }[] }) {
  const left = engines.slice(0, 6);
  const right = board?.machines ?? [];
  const rows = Math.max(left.length, right.length, 3);
  const H = rows * 54;
  const y = (i: number, n: number) => (H / n) * (i + 0.5);
  const c = board?.counts;
  const running = (m: string) => board?.items.filter((i) => i.machine === m && i.state === "running").length ?? 0;
  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between pb-3">
        <p className="text-[15px] font-semibold text-ink">Your engines and machines, wired in</p>
        <span className="text-[12px] text-ink-faint">
          {right.filter((m) => m.online).length} of {right.length} machines up · <Link href="/connections" className="font-semibold" style={{ color: "var(--ac-violet)" }}>Connections</Link>
        </span>
      </div>
      <div className="grid items-center gap-0" style={{ gridTemplateColumns: "minmax(150px,1fr) minmax(60px,0.6fr) minmax(190px,0.9fr) minmax(60px,0.6fr) minmax(170px,1fr)" }}>
        <div className="flex flex-col justify-around gap-2" style={{ height: H }}>
          {left.map((e) => (
            <div key={e.v} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2">
              <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: e.off ? "var(--ac-rose)" : "var(--ac-lime)" }} />
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">{e.l}</span>
              <span className="text-[11px] text-ink-faint">{e.off ? "not ready" : "ready"}</span>
            </div>
          ))}
        </div>
        <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" style={{ height: H, width: "100%" }} aria-hidden>
          {left.map((e, i) => (
            <path key={e.v} d={`M0,${y(i, left.length)} C50,${y(i, left.length)} 50,${H / 2} 100,${H / 2}`} fill="none" strokeWidth="1.2" vectorEffect="non-scaling-stroke" style={{ stroke: "var(--ac-violet)", opacity: e.off ? 0.15 : 0.45 }} />
          ))}
        </svg>
        <div className="flex flex-col gap-2 rounded-xl border px-4 py-3" style={{ borderColor: "color-mix(in srgb, var(--ac-violet) 40%, transparent)" }}>
          <p className="flex items-center gap-2 text-[14px] font-bold text-ink">
            <span className="flex h-6 w-6 items-center justify-center rounded-md text-[10px] font-bold text-white" style={{ background: "var(--ac-violet)" }}>MC</span>
            Mission Control
          </p>
          <p className="text-[12px] text-ink-dim">{c ? (c.running ? `${c.running} running now` : "Nothing running") : "…"}</p>
          <p className="text-[12px]" style={{ color: c && c.waiting ? "var(--ac-amber)" : "var(--color-ink-dim)" }}>{c ? (c.waiting ? `${c.waiting} need your OK` : "Nothing waits on you") : ""}</p>
          {board && board.yours > 0 && <p className="text-[12px] text-ink-faint">{board.yours} of your own to-dos in Work</p>}
          <Link href="/city" className="mt-1 rounded-lg px-3 py-1.5 text-center text-[12px] font-semibold text-white" style={{ background: "var(--ac-violet)" }}>
            Open the board →
          </Link>
        </div>
        <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" style={{ height: H, width: "100%" }} aria-hidden>
          {right.map((m, i) => (
            <path key={m.host} d={`M0,${H / 2} C50,${H / 2} 50,${y(i, right.length)} 100,${y(i, right.length)}`} fill="none" strokeWidth="1.2" vectorEffect="non-scaling-stroke" style={{ stroke: "var(--ac-violet)", opacity: m.online ? 0.45 : 0.15 }} />
          ))}
        </svg>
        <div className="flex flex-col justify-around gap-2" style={{ height: H }}>
          {right.map((m) => (
            <div key={m.host} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2">
              <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: m.online ? "var(--ac-lime)" : "var(--ac-rose)" }} />
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">{m.label}{m.master ? " ★" : ""}</span>
              <span className="text-[11px] text-ink-faint">{!m.online ? "off" : running(m.label) ? `${running(m.label)} running` : m.mem != null ? `mem ${m.mem}%` : "idle"}</span>
            </div>
          ))}
          {!right.length && <p className="text-[12px] text-ink-faint">Loading machines…</p>}
        </div>
      </div>
    </div>
  );
}
