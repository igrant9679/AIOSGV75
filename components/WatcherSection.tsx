"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ACCENTS, type Accent } from "@/lib/accents";
import type { WatchConfig, Sweep, Signal } from "@/lib/youtubeWatch";
import Panel from "./ui/Panel";
import StatusOrb from "./ui/StatusOrb";
import { IconPlus, IconTrash } from "./icons";
import { useMission } from "./store";

const CAT_ACCENT: Record<string, Accent> = {
  MODELS: "cyan",
  AGENTS: "violet",
  TOOLS: "lime",
  SEO: "amber",
  MONEY: "rose",
};

function ago(ts: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function WatcherSection() {
  const { addEvent } = useMission();
  const [config, setConfig] = useState<WatchConfig>({ channels: [], keywords: [] });
  const [sweeps, setSweeps] = useState<Sweep[]>([]);
  const [dayIndex, setDayIndex] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [chId, setChId] = useState("");
  const [chName, setChName] = useState("");
  const [kw, setKw] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/watcher");
      if (res.ok) {
        const j = (await res.json()) as { config: WatchConfig; sweeps: Sweep[] };
        setConfig(j.config ?? { channels: [], keywords: [] });
        setSweeps(j.sweeps ?? []);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const scan = async () => {
    setScanning(true);
    try {
      const res = await fetch("/api/watcher", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "scan" }),
      });
      if (res.ok) {
        addEvent("WATCHER", "Swept the skies for trends", "rose");
        setDayIndex(0);
        await load();
      }
    } finally {
      setScanning(false);
    }
  };

  const saveConfig = async (channels: WatchConfig["channels"], keywords: string[]) => {
    const res = await fetch("/api/watcher", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channels, keywords }),
    });
    if (res.ok) load();
  };

  const addChannel = () => {
    if (!/^UC[\w-]{20,}$/.test(chId.trim())) return;
    saveConfig([...config.channels, { id: chId.trim(), name: chName.trim() || chId.trim() }], config.keywords);
    setChId("");
    setChName("");
  };
  const removeChannel = (id: string) => saveConfig(config.channels.filter((c) => c.id !== id), config.keywords);
  const addKeyword = () => {
    if (!kw.trim()) return;
    saveConfig(config.channels, [...config.keywords, kw.trim()]);
    setKw("");
  };
  const removeKeyword = (k: string) => saveConfig(config.channels, config.keywords.filter((x) => x !== k));

  const sweep = sweeps[dayIndex];
  const magMax = useMemo(() => Math.max(1, ...(sweep?.signals ?? []).map((s) => s.magnitude)), [sweep]);

  return (
    <div className="flex flex-col gap-4">
      <Panel
        title="YouTube Watcher · Trend Radar"
        right={
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={scan}
            disabled={scanning || config.channels.length === 0}
            className="flex cursor-pointer items-center gap-2 rounded-lg bg-gradient-to-br from-rose-600 to-neon-rose px-4 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-35"
          >
            {scanning ? "scanning…" : "✦ Scan the skies"}
          </motion.button>
        }
      >
        <div className="flex flex-col gap-3 p-4">
          <p className="text-[12px] leading-5 text-ink-faint">
            Keyless YouTube monitoring — reads each channel&apos;s public RSS feed (no API key), scores recent videos by recency ·
            keyword · views, and drafts titles + angles. Rescans every 4h on the scheduler; every sweep logs to your vault. Find a
            channel ID in its page source or via any &quot;YouTube channel ID&quot; lookup (starts with <span className="font-mono">UC…</span>).
          </p>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="flex flex-col gap-2">
              <p className="font-mono text-[10px] tracking-[0.14em] text-ink-faint">CHANNELS · {config.channels.length}</p>
              {config.channels.map((c) => (
                <div key={c.id} className="flex items-center gap-2 rounded-lg border border-line bg-white/[0.02] px-3 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">{c.name}</span>
                  <span className="font-mono text-[9px] text-ink-faint">{c.id.slice(0, 10)}…</span>
                  <button onClick={() => removeChannel(c.id)} aria-label={`Remove ${c.name}`} className="cursor-pointer text-ink-faint hover:text-neon-rose">
                    <IconTrash width={12} height={12} />
                  </button>
                </div>
              ))}
              <div className="flex gap-1.5">
                <input value={chName} onChange={(e) => setChName(e.target.value)} placeholder="Name" className="h-9 w-24 rounded-lg border border-line bg-panel-2 px-2 font-mono text-[11px] text-ink outline-none focus:border-line-bright" />
                <input value={chId} onChange={(e) => setChId(e.target.value)} placeholder="UC… channel id" className="h-9 flex-1 rounded-lg border border-line bg-panel-2 px-2 font-mono text-[11px] text-ink outline-none focus:border-line-bright" />
                <button onClick={addChannel} aria-label="Add channel" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line text-ink-dim hover:bg-white/[0.06]">
                  <IconPlus width={14} height={14} />
                </button>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <p className="font-mono text-[10px] tracking-[0.14em] text-ink-faint">KEYWORDS · {config.keywords.length} <span className="normal-case tracking-normal">(boost matching titles)</span></p>
              <div className="flex flex-wrap gap-1.5">
                {config.keywords.map((k) => (
                  <span key={k} className="flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 font-mono text-[10px] text-ink-dim">
                    {k}
                    <button onClick={() => removeKeyword(k)} aria-label={`Remove ${k}`} className="cursor-pointer text-ink-faint hover:text-neon-rose">✕</button>
                  </span>
                ))}
              </div>
              <div className="flex gap-1.5">
                <input value={kw} onChange={(e) => setKw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addKeyword()} placeholder="add a keyword…" className="h-9 flex-1 rounded-lg border border-line bg-panel-2 px-2 font-mono text-[11px] text-ink outline-none focus:border-line-bright" />
                <button onClick={addKeyword} aria-label="Add keyword" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line text-ink-dim hover:bg-white/[0.06]">
                  <IconPlus width={14} height={14} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </Panel>

      {sweeps.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="pr-1 font-mono text-[10px] tracking-[0.12em] text-ink-faint">SWEEPS</span>
          {sweeps.slice(0, 10).map((s, i) => (
            <button
              key={s.ts}
              onClick={() => setDayIndex(i)}
              className="cursor-pointer rounded-full border px-2.5 py-1 font-mono text-[10px] transition-colors"
              style={dayIndex === i ? { background: ACCENTS.rose.soft, color: ACCENTS.rose.base, borderColor: "transparent" } : { borderColor: "var(--color-line)", color: "var(--color-ink-faint)" }}
            >
              {i === 0 ? "LIVE" : s.day} · {ago(s.ts)}
            </button>
          ))}
        </div>
      )}

      <Panel title={sweep ? `${sweep.signals.length} signals` : "No sweeps yet"} delay={0.06}>
        <div className="grid gap-3 p-4 md:grid-cols-2">
          {!sweep && <p className="col-span-full py-10 text-center text-sm text-ink-faint">Add channels above and hit &quot;Scan the skies&quot; to light up the radar.</p>}
          {sweep?.signals.map((s) => {
            const c = ACCENTS[CAT_ACCENT[s.category] ?? "cyan"];
            const isOpen = open === s.videoId;
            return (
              <div key={s.videoId} className="rounded-2xl border border-line bg-white/[0.02] p-4" style={{ borderLeft: `3px solid ${c.base}` }}>
                <div className="flex items-start justify-between gap-2">
                  <span className="font-mono text-[10px] tracking-[0.1em]" style={{ color: c.base }}>STAR {String(s.rank).padStart(2, "0")} · {s.category}</span>
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-sm font-bold" style={{ color: c.base }}>{s.magnitude}</span>
                  </span>
                </div>
                <p className="pt-1.5 text-sm font-semibold leading-5 text-ink">{s.title}</p>
                <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
                  <div className="h-full rounded-full" style={{ width: `${(s.magnitude / magMax) * 100}%`, background: c.base }} />
                </div>
                <p className="pt-2 font-mono text-[10px] text-ink-faint">
                  {s.channel}{s.views ? ` · ${s.views.toLocaleString()} views` : ""} · {ago(s.published)}
                </p>
                <div className="flex items-center gap-2 pt-2">
                  <a href={s.url} target="_blank" className="rounded-md border border-line px-2 py-0.5 font-mono text-[10px] text-ink-dim hover:bg-white/[0.06]">▶ watch ↗</a>
                  {(s.titles?.length || s.angles?.length) ? (
                    <button onClick={() => setOpen(isOpen ? null : s.videoId)} className="cursor-pointer rounded-md border border-line px-2 py-0.5 font-mono text-[10px] text-ink-dim hover:bg-white/[0.06]">
                      {isOpen ? "hide dossier" : "▸ open dossier"}
                    </button>
                  ) : null}
                </div>
                {isOpen && (
                  <div className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
                    {s.titles?.length ? (
                      <div>
                        <p className="pb-1 font-mono text-[9px] tracking-[0.14em] text-ink-faint">TITLES — READY TO FIRE</p>
                        {s.titles.map((t, i) => (
                          <div key={i} className="flex items-center justify-between gap-2 py-0.5">
                            <span className="text-[12px] text-ink-dim">{t}</span>
                            <button onClick={() => navigator.clipboard?.writeText(t)} className="cursor-pointer font-mono text-[9px] text-ink-faint hover:text-neon-cyan">COPY</button>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {s.angles?.length ? (
                      <div>
                        <p className="pb-1 font-mono text-[9px] tracking-[0.14em] text-ink-faint">ANGLES</p>
                        {s.angles.map((a, i) => (
                          <p key={i} className="py-0.5 text-[12px] text-ink-dim">• {a}</p>
                        ))}
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}
