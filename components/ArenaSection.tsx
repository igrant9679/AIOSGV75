"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ACCENTS, type Accent } from "@/lib/accents";
import type { Mission } from "@/lib/missions";
import Panel from "./ui/Panel";
import StatusOrb from "./ui/StatusOrb";
import Avatar, { type AvatarKind } from "./Avatar";
import Markdown from "./Markdown";
import MicButton, { type MicState } from "./MicButton";
import { useMission } from "./store";
import { IconSwords } from "./icons";

interface Candidate {
  id: string;
  name: string;
  accent: Accent;
  kind?: AvatarKind;
  online: boolean;
}

interface Standing {
  agentId: string;
  wins: number;
  battles: number;
}

export default function ArenaSection() {
  const { system, agents, registry, addEvent } = useMission();
  const [prompt, setPrompt] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [battleId, setBattleId] = useState<string | null>(null);
  const [battle, setBattle] = useState<Mission | null>(null);
  const [voted, setVoted] = useState<string | null>(null);
  const [standings, setStandings] = useState<Standing[]>([]);
  const [err, setErr] = useState("");
  const [mic, setMic] = useState<MicState>({ listening: false, interim: "" });

  const candidates: Candidate[] = useMemo(
    () => [
      { id: "claude", name: "Claude", accent: "violet", kind: "claude" as AvatarKind, online: Boolean(system?.claudeVersion) },
      ...agents.map((a) => ({
        id: a.id,
        name: a.name,
        accent: a.accent,
        kind: (a.id === "openclaw" || a.id === "hermes" ? a.id : undefined) as AvatarKind | undefined,
        online: a.available,
      })),
      ...registry.llms.map((l) => ({ id: l.id, name: l.name, accent: l.accent, kind: undefined, online: l.hasKey })),
    ],
    [system, agents, registry],
  );
  const byId = useCallback((id: string) => candidates.find((c) => c.id === id), [candidates]);

  const loadStandings = useCallback(async () => {
    try {
      const res = await fetch("/api/arena");
      if (res.ok) setStandings(((await res.json()) as { standings: Standing[] }).standings ?? []);
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    loadStandings();
  }, [loadStandings]);

  // poll the active battle
  useEffect(() => {
    if (!battleId) return;
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch("/api/missions");
        if (!res.ok || !alive) return;
        const m = ((await res.json()) as { missions: Mission[] }).missions.find((x) => x.id === battleId) ?? null;
        setBattle(m);
      } catch {
        /* ignore */
      }
    };
    tick();
    const iv = setInterval(tick, 2000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [battleId]);

  const fighting = battle?.status === "running";

  const toggleAgent = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id].slice(-4)));

  const fight = async () => {
    setErr("");
    setVoted(null);
    try {
      const res = await fetch("/api/missions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: `⚔ ${prompt.slice(0, 50)}`, prompt, strategy: "arena", agentIds: selected }),
      });
      const json = (await res.json()) as { ok?: boolean; id?: string; error?: string };
      if (!res.ok || !json.ok) setErr(json.error ?? "failed to start battle");
      else {
        setBattleId(json.id ?? null);
        setBattle(null);
        addEvent("ARENA", `Battle started: ${selected.length} fighters`, "rose");
      }
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const crown = async (winnerId: string) => {
    if (!battle || voted) return;
    setVoted(winnerId);
    await fetch("/api/arena", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ winner: winnerId, participants: battle.agentIds, prompt: battle.prompt }),
    });
    addEvent("ARENA", `${byId(winnerId)?.name ?? winnerId} takes the crown 👑`, "amber");
    loadStandings();
  };

  const cols = battle ? Math.min(battle.results.length, 4) : 0;

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_280px]">
      <div className="flex flex-col gap-4">
        <Panel title="Arena — Same Prompt, Head to Head">
          <div className="flex flex-col gap-3 p-4">
            <div
              className="flex items-end gap-1.5 rounded-2xl border border-line bg-panel-2 p-1.5 transition-colors focus-within:border-line-bright"
              style={mic.listening ? { borderColor: "rgba(251,113,133,0.4)" } : undefined}
            >
              <textarea
                value={mic.listening && mic.interim ? `${prompt ? prompt + " " : ""}${mic.interim}` : prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={2}
                placeholder={mic.listening ? "Listening…" : "One prompt. Several models. You judge."}
                aria-label="Arena prompt"
                className="min-h-12 flex-1 resize-none bg-transparent px-3 py-2 text-[13.5px] leading-6 text-ink outline-none placeholder:text-ink-faint"
              />
              <MicButton onFinal={(t) => setPrompt((p) => (p ? `${p.replace(/\s+$/, "")} ${t}` : t))} onState={setMic} />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                {candidates.map((c) => {
                  const on = selected.includes(c.id);
                  const col = ACCENTS[c.accent];
                  return (
                    <button
                      key={c.id}
                      onClick={() => c.online && toggleAgent(c.id)}
                      disabled={!c.online}
                      aria-pressed={on}
                      className="flex cursor-pointer items-center gap-2 rounded-xl border px-2.5 py-1.5 text-xs font-medium transition-all disabled:cursor-not-allowed disabled:opacity-30"
                      style={{
                        borderColor: on ? col.border : "var(--color-line)",
                        background: on ? col.soft : "transparent",
                        color: on ? col.base : "var(--color-ink-dim)",
                      }}
                    >
                      <Avatar kind={c.kind} name={c.name} accent={c.accent} size={20} />
                      {c.name}
                    </button>
                  );
                })}
              </div>
              <motion.button
                whileTap={{ scale: 0.96 }}
                onClick={fight}
                disabled={!prompt.trim() || selected.length < 2 || fighting}
                className="flex cursor-pointer items-center gap-2 rounded-xl bg-gradient-to-br from-rose-600 to-neon-rose px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-rose-500/20 disabled:cursor-not-allowed disabled:opacity-35"
              >
                <IconSwords width={16} height={16} />
                {fighting ? "Fighting…" : "Fight"}
              </motion.button>
            </div>
            {err && (
              <p role="alert" className="rounded-lg border border-neon-rose/30 bg-neon-rose/10 px-3 py-2 font-mono text-[11px] text-neon-rose">
                {err}
              </p>
            )}
          </div>
        </Panel>

        {battle && (
          <div className={`grid gap-3 ${cols >= 3 ? "lg:grid-cols-3" : cols === 2 ? "lg:grid-cols-2" : ""} ${cols === 4 ? "xl:grid-cols-4" : ""}`}>
            {battle.results.map((r) => {
              const c = byId(r.agentId);
              const col = ACCENTS[c?.accent ?? "cyan"];
              const isWinner = voted === r.agentId;
              return (
                <Panel
                  key={r.agentId}
                  className={isWinner ? "!border-neon-amber/60" : ""}
                  title={c?.name ?? r.agentId}
                  right={
                    <div className="flex items-center gap-2">
                      <StatusOrb
                        accent={r.status === "done" ? "lime" : r.status === "error" ? "rose" : "amber"}
                        pulsing={r.status === "running" || r.status === "pending"}
                        size={7}
                      />
                      <span className="font-mono text-[9.5px] text-ink-faint">
                        {r.status === "done" ? `${(r.ms / 1000).toFixed(1)}s` : r.status}
                      </span>
                    </div>
                  }
                >
                  <div className="flex h-full flex-col">
                    <div className="max-h-96 min-h-40 flex-1 overflow-y-auto px-4 py-3 text-[12.5px] leading-6 text-ink">
                      {r.error ? (
                        <span className="whitespace-pre-wrap text-neon-rose">{r.error}</span>
                      ) : r.text ? (
                        <Markdown>{r.text}</Markdown>
                      ) : (
                        <span className="text-ink-faint">thinking…</span>
                      )}
                    </div>
                    {battle.status !== "running" && r.status === "done" && (
                      <div className="border-t border-line p-3">
                        <motion.button
                          whileTap={{ scale: 0.95 }}
                          onClick={() => crown(r.agentId)}
                          disabled={Boolean(voted)}
                          className={`w-full cursor-pointer rounded-lg py-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed ${
                            isWinner
                              ? "bg-neon-amber text-black"
                              : voted
                                ? "bg-white/5 text-ink-faint"
                                : "text-white"
                          }`}
                          style={!voted ? { background: `linear-gradient(135deg, ${col.gradFrom}, ${col.base})` } : undefined}
                        >
                          {isWinner ? "👑 Winner" : "Crown Winner"}
                        </motion.button>
                      </div>
                    )}
                  </div>
                </Panel>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-4">
        <Panel title="Leaderboard" delay={0.05}>
          <div className="flex flex-col gap-2 p-3">
            {standings.length === 0 && (
              <p className="px-2 py-4 text-center text-[11px] leading-5 text-ink-faint">
                No battles judged yet. Winners you crown build a ranking of which model earns MoA seats.
              </p>
            )}
            {standings.map((s, i) => {
              const c = byId(s.agentId);
              const rate = s.battles > 0 ? s.wins / s.battles : 0;
              return (
                <div key={s.agentId} className="flex items-center gap-2.5 rounded-xl border border-line bg-white/[0.02] px-3 py-2">
                  <span className="w-4 font-mono text-[11px] font-bold text-ink-faint">{i + 1}</span>
                  <Avatar kind={c?.kind} name={c?.name ?? s.agentId} accent={c?.accent ?? "cyan"} size={24} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-ink">{c?.name ?? s.agentId}</p>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/5">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${rate * 100}%`, background: ACCENTS[c?.accent ?? "cyan"].base }}
                      />
                    </div>
                  </div>
                  <span className="font-mono text-[10px] text-ink-dim">
                    {s.wins}/{s.battles}
                  </span>
                </div>
              );
            })}
          </div>
        </Panel>

        <Panel title="How It Works" delay={0.1}>
          <p className="p-4 text-[11.5px] leading-5 text-ink-dim">
            Pick 2–4 fighters, fire one prompt, and read the answers side by side. Crown the best one — the
            leaderboard tracks win rates so you learn which models deserve seats in your Missions.
          </p>
        </Panel>
      </div>
    </div>
  );
}
