"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Board, BoardAction, BoardItem, BoardState } from "@/lib/board";

/**
 * The Board (/city, rule 49): everything the fleet is doing or waiting on, two ways.
 *   Office — one room per machine; each piece of running work is a little bot at a desk in the room of the
 *            machine it runs on; what waits on you stands at the front desk, what is queued sits in the inbox.
 *   Board  — five columns (waiting on you, pending, running, done, failed) with the buttons that settle each.
 */

const STATES: { key: BoardState; label: string; hint: string; color: string }[] = [
  { key: "waiting", label: "Waiting on you", hint: "Needs your OK before it goes on", color: "var(--ac-amber)" },
  { key: "pending", label: "Pending", hint: "In line, not started yet", color: "var(--color-ink-faint)" },
  { key: "running", label: "Running", hint: "Being worked on right now", color: "var(--ac-violet)" },
  { key: "done", label: "Done", hint: "Finished in the last day", color: "var(--ac-lime)" },
  { key: "failed", label: "Failed", hint: "Didn't finish", color: "var(--ac-rose)" },
];
const colorOf = (s: BoardState) => STATES.find((x) => x.key === s)!.color;

export default function CitySection() {
  const [board, setBoard] = useState<Board | null>(null);
  const [view, setView] = useState<"office" | "board">("office");
  const [q, setQ] = useState("");
  const [machine, setMachine] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);

  const load = useCallback(() => {
    fetch("/api/board").then((r) => r.json()).then((b) => (b.items ? setBoard(b) : setMsg({ text: b.error ?? "Couldn't load the board", bad: true }))).catch((e: Error) => setMsg({ text: e.message, bad: true }));
  }, []);
  useEffect(() => {
    try {
      const v = localStorage.getItem("mc-city-view");
      if (v === "board" || v === "office") setView(v);
    } catch {
      /* default */
    }
    load();
    const t = setInterval(load, 6000);
    return () => clearInterval(t);
  }, [load]);
  const pickView = (v: "office" | "board") => {
    setView(v);
    try {
      localStorage.setItem("mc-city-view", v);
    } catch {
      /* fine */
    }
  };
  const act = async (item: BoardItem, a: BoardAction) => {
    setBusy(item.id + a.label);
    setMsg(null);
    try {
      const r = await (await fetch(a.path, { method: a.method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(a.body) })).json();
      setMsg(r.error ? { text: `${a.label}: ${r.error}`, bad: true } : { text: `${a.label}: done.` });
    } catch (e) {
      setMsg({ text: (e as Error).message, bad: true });
    }
    setBusy(null);
    setTimeout(load, 600);
  };

  const items = useMemo(() => (board?.items ?? []).filter((i) => (!machine || i.machine === machine) && (!q || `${i.title} ${i.kindLabel} ${i.machine ?? ""} ${i.engine ?? ""} ${i.area ?? ""}`.toLowerCase().includes(q.toLowerCase()))), [board, q, machine]);
  const c = board?.counts ?? { waiting: 0, pending: 0, running: 0, done: 0, failed: 0 };
  const selected = board?.items.find((i) => i.id === sel) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {STATES.map((s) => (
          <span key={s.key} className="studio-chip" style={{ display: "inline-flex", height: "2.6rem", borderColor: s.key === "waiting" && c.waiting ? "color-mix(in srgb, var(--ac-amber) 55%, transparent)" : undefined }}>
            <b className="text-[18px] text-ink">{c[s.key]}</b>
            <span style={{ color: s.color }}>{s.label}</span>
          </span>
        ))}
        <span className="flex-1" />
        <span className="studio-seg" style={{ display: "inline-flex" }} role="group" aria-label="View">
          <button type="button" aria-pressed={view === "office"} onClick={() => pickView("office")}>Office</button>
          <button type="button" aria-pressed={view === "board"} onClick={() => pickView("board")}>Board</button>
        </span>
        <Link href="/agents" className="studio-chip" style={{ display: "inline-flex" }}>Agents</Link>
      </div>
      {msg && <p className="text-[12px]" style={{ color: msg.bad ? "var(--ac-rose)" : "var(--ac-lime)" }}>{msg.text}</p>}
      {board && board.yours > 0 && (
        <p className="text-[12px] text-ink-faint">
          Your own {board.yours} to-dos live in <Link href="/work" className="underline">Work</Link>; this board is what the fleet is doing and what it needs from you.{board.notes.length ? ` ${board.notes.join(" · ")}` : ""}
        </p>
      )}

      {view === "office" ? (
        <div className="panel overflow-hidden p-3">
          {board ? <Office board={board} onPick={setSel} sel={sel} /> : <p className="p-6 text-[13px] text-ink-faint">Loading the office…</p>}
          {selected && (
            <div className="mx-auto max-w-xl pb-2">
              <Card item={selected} act={act} busy={busy} />
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search work, machines or engines" aria-label="Search the board" className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-transparent px-3 text-[13px] text-ink outline-none" />
            <select value={machine} onChange={(e) => setMachine(e.target.value)} aria-label="Machine" className="h-9 rounded-lg border border-line bg-transparent px-2 text-[13px] text-ink">
              <option value="" style={{ background: "var(--color-panel)" }}>All machines</option>
              {(board?.machines ?? []).map((m) => (
                <option key={m.host} value={m.label} style={{ background: "var(--color-panel)" }}>{m.label}</option>
              ))}
            </select>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            {STATES.map((s) => {
              const list = items.filter((i) => i.state === s.key).sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
              return (
                <div key={s.key} className="panel flex max-h-[72vh] flex-col gap-2 overflow-y-auto p-3">
                  <p className="flex items-center gap-2 text-[13px] font-semibold text-ink">
                    <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} /> {s.label} <span className="ml-auto text-ink-faint">{list.length}</span>
                  </p>
                  <p className="text-[11px] text-ink-faint">{s.hint}</p>
                  {list.slice(0, 60).map((i) => (
                    <Card key={i.id} item={i} act={act} busy={busy} />
                  ))}
                  {!list.length && <p className="py-4 text-center text-[12px] text-ink-faint">Nothing here.</p>}
                  {list.length > 60 && <p className="text-[11px] text-ink-faint">+ {list.length - 60} more</p>}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function Card({ item, act, busy }: { item: BoardItem; act: (i: BoardItem, a: BoardAction) => void; busy: string | null }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-line p-2.5" style={item.state === "waiting" ? { borderColor: "color-mix(in srgb, var(--ac-amber) 45%, transparent)" } : undefined}>
      <p className="flex items-center gap-1.5 text-[11px] text-ink-faint">
        <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: colorOf(item.state) }} />
        {item.kindLabel}
        {item.area ? ` · ${item.area}` : ""}
      </p>
      <p className="text-[13px] font-semibold leading-5 text-ink">{item.title}</p>
      {item.detail && <p className="line-clamp-3 text-[12px] leading-4 text-ink-dim">{item.detail}</p>}
      {(item.machine || item.engine) && <p className="text-[11px] text-ink-faint">{[item.machine, item.engine].filter(Boolean).join(" · ")}</p>}
      <div className="flex flex-wrap items-center gap-1.5">
        {(item.actions ?? []).map((a) => (
          <button
            key={a.label}
            type="button"
            disabled={busy === item.id + a.label}
            onClick={() => act(item, a)}
            className="cursor-pointer rounded-lg px-2.5 py-1 text-[12px] font-semibold disabled:opacity-50"
            style={a.style === "primary" ? { background: "var(--ac-violet)", color: "#fff" } : { border: "1px solid var(--tone-line-bright)", color: a.style === "danger" ? "var(--ac-rose)" : "var(--color-ink-dim)" }}
          >
            {a.label}
          </button>
        ))}
        {item.href && (
          <Link href={item.href} className="ml-auto text-[11px] text-ink-faint underline">
            Open
          </Link>
        )}
      </div>
    </div>
  );
}

// ─── the office ───

const U = 34; // one floor tile
// an oblique view: rooms run left to right, depth goes down and to the left (six rooms in a true isometric
// row become one long thin diagonal)
const iso = (x: number, y: number, z = 0): [number, number] => [x * U - y * U * 0.5, y * U * 0.82 - z * U];
const pts = (p: [number, number][]) => p.map((a) => a.join(",")).join(" ");

/** A small bot standing at (x, y). */
function Bot({ x, y, color, label, active, selected, onClick }: { x: number; y: number; color: string; label: string; active?: boolean; selected?: boolean; onClick: () => void }) {
  const [sx, sy] = iso(x, y);
  return (
    <g transform={`translate(${sx},${sy})`} style={{ cursor: "pointer" }} onClick={onClick} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onClick()} aria-label={label}>
      <title>{label}</title>
      <ellipse cx="0" cy="2" rx="9" ry="4" fill="rgba(0,0,0,0.18)" />
      <g className={active ? "city-bob" : undefined}>
        <rect x="-8" y="-24" width="16" height="22" rx="8" fill="var(--surface-panel)" stroke={color} strokeWidth={selected ? 2.6 : 1.6} />
        <circle cx="-3" cy="-15" r="1.6" fill={color} />
        <circle cx="3" cy="-15" r="1.6" fill={color} />
        {active && <circle cx="0" cy="-30" r="2.4" fill={color} className="city-ping" />}
      </g>
    </g>
  );
}

function Office({ board, onPick, sel }: { board: Board; onPick: (id: string | null) => void; sel: string | null }) {
  const machines = board.machines;
  const W = 5, D = 4, GAP = 1; // room size in tiles
  const roomX = (i: number) => i * (W + GAP);
  const span = machines.length * (W + GAP);
  const by = (m: string, s: BoardState) => board.items.filter((i) => i.machine === m && i.state === s);
  const waiting = board.items.filter((i) => i.state === "waiting");
  const pending = board.items.filter((i) => i.state === "pending");
  // bounds of the drawing
  const corners = [iso(-0.6, -0.6, 3.2), iso(span, -0.6, 3.2), iso(span, D + 5.6), iso(-0.6, D + 5.6)];
  const minX = Math.min(...corners.map((p) => p[0])) - 14, maxX = Math.max(...corners.map((p) => p[0])) + 14;
  const minY = Math.min(...corners.map((p) => p[1])) - 8, maxY = Math.max(...corners.map((p) => p[1])) + 46;
  const tag = (x: number, y: number, z: number, title: string, sub: string, color: string) => {
    const [sx, sy] = iso(x, y, z);
    const w = Math.max(title.length * 6.6 + 22, sub.length * 5.4 + 22);
    return (
      <g transform={`translate(${sx - w / 2},${sy - 30})`}>
        <rect width={w} height="30" rx="8" fill="var(--surface-panel)" stroke="var(--tone-line-bright)" />
        <circle cx="10" cy="11" r="3" fill={color} />
        <text x="18" y="14.5" fontSize="11" fontWeight="700" fill="var(--tone-ink)">{title}</text>
        <text x="18" y="25" fontSize="9" fill="var(--tone-ink-faint)">{sub}</text>
      </g>
    );
  };
  return (
    <svg viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`} className="w-full" style={{ maxHeight: "66vh" }} role="img" aria-label="The office: one room per machine">
      <style>{`.city-bob{animation:cityBob 1.6s ease-in-out infinite}.city-ping{animation:cityPing 1.2s ease-in-out infinite}@keyframes cityBob{50%{transform:translateY(-3px)}}@keyframes cityPing{50%{opacity:.25}}@media (prefers-reduced-motion: reduce){.city-bob,.city-ping{animation:none}}`}</style>
      {/* the floor slab */}
      <polygon points={pts([iso(-0.6, -0.6), iso(span - GAP + 0.6, -0.6), iso(span - GAP + 0.6, D + 5.6), iso(-0.6, D + 5.6)])} fill="var(--surface-abyss)" stroke="var(--tone-line)" />
      {machines.map((m, i) => {
        const x0 = roomX(i);
        const run = by(m.label, "running");
        const done = by(m.label, "done").length;
        const failed = by(m.label, "failed").length;
        const tint = m.online ? "var(--ac-violet)" : "var(--tone-ink-faint)";
        return (
          <g key={m.host} opacity={m.online ? 1 : 0.45}>
            {/* floor, back wall, side wall */}
            <polygon points={pts([iso(x0, 0), iso(x0 + W, 0), iso(x0 + W, D), iso(x0, D)])} fill={`color-mix(in srgb, ${tint} ${run.length ? 14 : 6}%, var(--surface-panel))`} stroke="var(--tone-line-bright)" />
            <polygon points={pts([iso(x0, 0), iso(x0 + W, 0), iso(x0 + W, 0, 1.3), iso(x0, 0, 1.3)])} fill="var(--surface-panel)" stroke="var(--tone-line)" />
            <polygon points={pts([iso(x0, 0), iso(x0, D), iso(x0, D, 1.3), iso(x0, 0, 1.3)])} fill="var(--surface-panel-2)" stroke="var(--tone-line)" />
            {/* desks: 2 rows of 3 */}
            {[0, 1, 2, 3, 4, 5].map((d) => {
              const dx = x0 + 0.9 + (d % 3) * 1.45, dy = 0.9 + Math.floor(d / 3) * 1.6;
              return (
                <g key={d}>
                  <polygon points={pts([iso(dx, dy, 0.45), iso(dx + 0.9, dy, 0.45), iso(dx + 0.9, dy + 0.5, 0.45), iso(dx, dy + 0.5, 0.45)])} fill="var(--surface-panel)" stroke="var(--tone-line-bright)" />
                  <polygon points={pts([iso(dx + 0.25, dy + 0.1, 0.45), iso(dx + 0.65, dy + 0.1, 0.45), iso(dx + 0.65, dy + 0.1, 0.85), iso(dx + 0.25, dy + 0.1, 0.85)])} fill={run[d] ? tint : "var(--tone-line-bright)"} opacity={run[d] ? 0.9 : 0.6} />
                </g>
              );
            })}
            {run.slice(0, 6).map((it, d) => (
              <Bot key={it.id} x={x0 + 1.35 + (d % 3) * 1.45} y={1.75 + Math.floor(d / 3) * 1.6} color="var(--ac-violet)" label={`${it.title} (${it.kindLabel}${it.engine ? `, ${it.engine}` : ""})`} active selected={sel === it.id} onClick={() => onPick(sel === it.id ? null : it.id)} />
            ))}
            {tag(x0 + W / 2, 0, 2.1, `${m.label}${m.master ? " ★" : ""}`, !m.online ? "off" : run.length ? `${run.length} running${run.length > 6 ? " (6 shown)" : ""}` : `quiet${done ? ` · ${done} done today` : ""}${failed ? ` · ${failed} failed` : ""}`, !m.online ? "var(--ac-rose)" : run.length ? "var(--ac-violet)" : "var(--ac-lime)")}
          </g>
        );
      })}
      {/* front desk: what waits on you */}
      <polygon points={pts([iso(span * 0.3, D + 2.2), iso(span * 0.3 + 8, D + 2.2), iso(span * 0.3 + 8, D + 3.2), iso(span * 0.3, D + 3.2)])} fill="color-mix(in srgb, var(--ac-amber) 14%, var(--surface-panel))" stroke="var(--ac-amber)" />
      {waiting.slice(0, 10).map((it, i) => (
        <Bot key={it.id} x={span * 0.3 + 0.5 + i * 0.75} y={D + 2.9} color="var(--ac-amber)" label={`Waiting on you: ${it.title} (${it.kindLabel})`} selected={sel === it.id} onClick={() => onPick(sel === it.id ? null : it.id)} />
      ))}
      {tag(span * 0.3 + 4, D + 3.4, -0.6, "Waiting on you", waiting.length ? `${waiting.length}: click one to settle it` : "nothing", "var(--ac-amber)")}
      {/* inbox: what is queued */}
      <polygon points={pts([iso(0.4, D + 1.8), iso(2.6, D + 1.8), iso(2.6, D + 3), iso(0.4, D + 3)])} fill="var(--surface-panel)" stroke="var(--tone-line-bright)" />
      {pending.slice(0, 4).map((it, i) => (
        <Bot key={it.id} x={0.8 + i * 0.55} y={D + 2.7} color="var(--tone-ink-faint)" label={`Pending: ${it.title} (${it.kindLabel})`} selected={sel === it.id} onClick={() => onPick(sel === it.id ? null : it.id)} />
      ))}
      {tag(1.5, D + 3.2, -0.6, "Inbox", `${pending.length} pending`, "var(--tone-ink-faint)")}
      {/* done shelf */}
      <polygon points={pts([iso(span - GAP - 2.4, D + 1.8), iso(span - GAP - 0.4, D + 1.8), iso(span - GAP - 0.4, D + 1.8, 1), iso(span - GAP - 2.4, D + 1.8, 1)])} fill="color-mix(in srgb, var(--ac-lime) 16%, var(--surface-panel))" stroke="var(--tone-line-bright)" />
      {tag(span - GAP - 1.4, D + 3.2, -0.6, "Done shelf", `${board.counts.done} today${board.counts.failed ? ` · ${board.counts.failed} failed` : ""}`, "var(--ac-lime)")}
    </svg>
  );
}
