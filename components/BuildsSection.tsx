"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ACCENTS } from "@/lib/accents";
import type { Build } from "@/lib/builds";
import Panel from "./ui/Panel";
import NumberTicker from "./ui/NumberTicker";
import StatusOrb from "./ui/StatusOrb";
import MicButton from "./MicButton";
import { IconTrash } from "./icons";
import { useMission } from "./store";

/** The Builds shelf — commission single-file games & apps, play them in-place. */

const TRY: { label: string; kind: "game" | "app" }[] = [
  { label: "A neon snake that grows through a glowing grid, speeds up every 5 points", kind: "game" },
  { label: "A 3D-feel tunnel racer — dodge obstacles, survive as long as possible", kind: "game" },
  { label: "A pomodoro timer with a glowing progress ring and session history", kind: "app" },
  { label: "A breakout clone with particle explosions and screen shake", kind: "game" },
];

function ago(ts: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function BuildsSection() {
  const { addEvent } = useMission();
  const [builds, setBuilds] = useState<Build[]>([]);
  const [prompt, setPrompt] = useState("");
  const [kind, setKind] = useState<"game" | "app">("game");
  const [playing, setPlaying] = useState<Build | null>(null);
  const [playHtml, setPlayHtml] = useState("");
  const [err, setErr] = useState("");

  const anyBuilding = builds.some((b) => b.status === "building");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/builds");
      if (res.ok) setBuilds(((await res.json()) as { builds: Build[] }).builds ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, anyBuilding ? 5_000 : 30_000);
    return () => clearInterval(t);
  }, [load, anyBuilding]);

  const commission = async () => {
    const p = prompt.trim();
    if (!p) return;
    setErr("");
    setPrompt("");
    const res = await fetch("/api/builds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: p, kind }),
    });
    const json = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok || !json.ok) {
      setErr(json.error ?? "build failed to start");
      setPrompt(p);
      return;
    }
    addEvent("BUILDS", `Commissioned ${kind}: ${p.slice(0, 60)}`, "magenta");
    load();
  };

  const play = async (b: Build) => {
    setPlaying(b);
    setPlayHtml("");
    try {
      const res = await fetch(`/api/builds?id=${encodeURIComponent(b.id)}`);
      if (res.ok) setPlayHtml(((await res.json()) as { html: string }).html ?? "");
    } catch {
      /* ignore */
    }
  };

  const done = builds.filter((b) => b.status === "done");

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Commission the Builder" right={<span className="font-mono text-[10px] text-ink-faint">Claude brain · single-file · no libraries · lives in your vault</span>}>
        <div className="flex flex-col gap-3 p-4">
          {err && <p className="rounded-lg border border-neon-rose/30 bg-neon-rose/10 px-3 py-1.5 font-mono text-[11px] text-neon-rose">{err}</p>}
          <div className="flex items-start gap-2">
            <div className="flex shrink-0 flex-col gap-1 rounded-xl border border-line p-1">
              {(["game", "app"] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setKind(k)}
                  className="cursor-pointer rounded-lg px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.1em] transition-colors"
                  style={
                    kind === k
                      ? { background: ACCENTS.magenta.soft, color: ACCENTS.magenta.base }
                      : { color: "var(--color-ink-faint)" }
                  }
                >
                  {k}
                </button>
              ))}
            </div>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  commission();
                }
              }}
              rows={2}
              placeholder={kind === "game" ? 'Describe a game… "a neon snake that grows through a 3D grid" — press Enter' : 'Describe an app… "a habit tracker with streaks" — press Enter'}
              className="min-h-16 w-full resize-none rounded-xl border border-line bg-panel-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-line-bright"
            />
            <div className="flex flex-col gap-2">
              <MicButton onFinal={(t) => setPrompt((p) => (p ? `${p} ${t}` : t))} />
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={commission}
                disabled={!prompt.trim()}
                className="cursor-pointer rounded-xl bg-gradient-to-br from-fuchsia-700 to-neon-magenta px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-35"
              >
                Build it
              </motion.button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {TRY.map((t) => (
              <button
                key={t.label}
                onClick={() => {
                  setKind(t.kind);
                  setPrompt(t.label);
                }}
                className="cursor-pointer rounded-full border border-line px-2.5 py-1 text-[11px] text-ink-faint transition-colors hover:border-line-bright hover:text-ink"
              >
                {t.label.slice(0, 48)}…
              </button>
            ))}
          </div>
        </div>
      </Panel>

      <Panel
        title={`The Shelf · ${done.length} builds · click to play`}
        right={
          <span style={{ color: ACCENTS.magenta.base }}>
            <NumberTicker value={builds.length} className="font-mono text-[11px] font-bold" />
          </span>
        }
        delay={0.06}
      >
        <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
          {builds.length === 0 && (
            <p className="col-span-full py-10 text-center text-sm text-ink-faint">
              Nothing on the shelf yet — commission your first build above.
            </p>
          )}
          {builds.map((b) => (
            <div key={b.id} className="group rounded-2xl border border-line bg-white/[0.02] p-4 transition-colors hover:border-line-bright">
              <div className="flex items-center justify-between">
                <span
                  className="rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em]"
                  style={{ background: ACCENTS[b.kind === "game" ? "magenta" : "cyan"].soft, color: ACCENTS[b.kind === "game" ? "magenta" : "cyan"].base }}
                >
                  {b.kind}
                </span>
                <span className="flex items-center gap-2">
                  <StatusOrb accent={b.status === "done" ? "lime" : b.status === "error" ? "rose" : "amber"} pulsing={b.status === "building"} size={7} />
                  <button
                    onClick={async () => {
                      await fetch(`/api/builds?id=${encodeURIComponent(b.id)}`, { method: "DELETE" });
                      load();
                    }}
                    aria-label={`Delete ${b.title}`}
                    className="cursor-pointer rounded p-1 text-ink-faint opacity-0 transition-opacity hover:text-neon-rose group-hover:opacity-100"
                  >
                    <IconTrash width={12} height={12} />
                  </button>
                </span>
              </div>
              <p className="pt-2 text-sm font-semibold leading-5 text-ink">{b.title}</p>
              <p className="pt-1 font-mono text-[10px] text-ink-faint">
                {b.status === "building" ? "building… 30–120s" : b.status === "error" ? (b.error ?? "failed").slice(0, 60) : `${(b.size / 1024).toFixed(0)} KB · ${ago(b.createdAt)}`}
              </p>
              {b.status === "done" && (
                <div className="flex gap-2 pt-3">
                  <button
                    onClick={() => play(b)}
                    className="flex-1 cursor-pointer rounded-lg py-1.5 text-center text-xs font-semibold text-black"
                    style={{ background: ACCENTS.lime.base }}
                  >
                    ▶ Play
                  </button>
                  <a
                    href={`/api/builds?id=${encodeURIComponent(b.id)}&raw=1`}
                    target="_blank"
                    className="cursor-pointer rounded-lg border border-line px-3 py-1.5 text-xs text-ink-dim transition-colors hover:bg-white/[0.06]"
                  >
                    tab ↗
                  </a>
                </div>
              )}
            </div>
          ))}
        </div>
      </Panel>

      {playing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setPlaying(null)}>
          <div className="panel flex h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-line-bright" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <span className="text-sm font-semibold text-ink">{playing.title}</span>
              <span className="flex items-center gap-2">
                <a
                  href={`/api/builds?id=${encodeURIComponent(playing.id)}&raw=1`}
                  target="_blank"
                  className="rounded-md border border-line px-2 py-0.5 font-mono text-[10px] text-ink-dim hover:bg-white/[0.06]"
                >
                  open in tab ↗
                </a>
                <button onClick={() => setPlaying(null)} className="cursor-pointer rounded-md border border-line px-2 py-0.5 font-mono text-[10px] text-ink-dim hover:bg-white/[0.06]">
                  ✕ close
                </button>
              </span>
            </div>
            {playHtml ? (
              <iframe srcDoc={playHtml} sandbox="allow-scripts allow-pointer-lock" className="h-full w-full flex-1 bg-black" title={playing.title} />
            ) : (
              <p className="flex flex-1 items-center justify-center text-sm text-ink-faint">Loading…</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
