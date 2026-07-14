"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ACCENTS, type Accent } from "@/lib/accents";
import Panel from "./ui/Panel";
import StatusOrb from "./ui/StatusOrb";
import EmptyState from "./ui/EmptyState";
import { IconStudio, IconSpark, IconTrash, IconMic, IconRocket } from "./icons";
import { useMission } from "./store";

type Kind = "image" | "voice" | "video";

interface StudioItem {
  id: string;
  kind: Kind;
  prompt: string;
  provider: string;
  model: string;
  status: "generating" | "done" | "error";
  error?: string;
  meta: { size?: string; voice?: string; quality?: string; bytes?: number };
  createdAt: number;
}

interface ServiceStatus {
  id: string;
  label: string;
  categories: Kind[];
  configured: boolean;
}

const TABS: { kind: Kind; label: string; accent: Accent; icon: typeof IconSpark }[] = [
  { kind: "image", label: "Image", accent: "cyan", icon: IconStudio },
  { kind: "voice", label: "Voice", accent: "violet", icon: IconMic },
  { kind: "video", label: "Video", accent: "magenta", icon: IconSpark },
];

const IMAGE_SIZES = [
  { v: "1024x1024", label: "Square" },
  { v: "1536x1024", label: "Landscape" },
  { v: "1024x1536", label: "Portrait" },
];
const IMAGE_QUALITY = ["low", "medium", "high"];
const GEMINI_ASPECTS = [
  { v: "1:1", label: "Square" },
  { v: "16:9", label: "Widescreen" },
  { v: "9:16", label: "Vertical" },
  { v: "4:3", label: "Landscape" },
  { v: "3:4", label: "Portrait" },
  { v: "3:2", label: "Photo" },
  { v: "2:3", label: "Tall" },
];
const OPENAI_VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer", "coral", "sage"];

const inputCls =
  "w-full rounded-lg border border-line bg-panel-2 px-3 py-2 font-mono text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-line-bright";
const labelCls = "mb-1 block font-mono text-[10px] tracking-[0.14em] text-ink-faint";

function bytesLabel(n?: number): string {
  if (!n) return "";
  return n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`;
}

export default function StudioSection() {
  const { addEvent } = useMission();
  const [tab, setTab] = useState<Kind>("image");
  const [services, setServices] = useState<ServiceStatus[]>([]);
  const [items, setItems] = useState<StudioItem[]>([]);
  const [vaultOk, setVaultOk] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // form state
  const [prompt, setPrompt] = useState("");
  const [provider, setProvider] = useState("");
  const [size, setSize] = useState("1024x1024");
  const [quality, setQuality] = useState("medium");
  const [aspect, setAspect] = useState("1:1");
  const [voice, setVoice] = useState("alloy");
  const [videoModel, setVideoModel] = useState("minimax/video-01");

  const loadServices = useCallback(async () => {
    try {
      const res = await fetch("/api/services");
      if (res.ok) setServices(((await res.json()) as { services: ServiceStatus[] }).services ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  const loadItems = useCallback(async () => {
    try {
      const res = await fetch("/api/studio");
      if (res.ok) {
        const j = (await res.json()) as { items: StudioItem[]; vaultOk: boolean };
        setItems(j.items ?? []);
        setVaultOk(j.vaultOk);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    loadServices();
    loadItems();
  }, [loadServices, loadItems]);

  // poll while anything is still generating
  const generating = items.some((x) => x.status === "generating");
  useEffect(() => {
    if (!generating) return;
    const t = setInterval(loadItems, 4000);
    return () => clearInterval(t);
  }, [generating, loadItems]);

  const providersFor = useCallback(
    (kind: Kind) => services.filter((s) => s.categories.includes(kind)),
    [services],
  );
  const readyProviders = useMemo(() => providersFor(tab).filter((s) => s.configured), [providersFor, tab]);

  // keep the selected provider valid for the active tab
  useEffect(() => {
    if (readyProviders.length && !readyProviders.some((p) => p.id === provider)) {
      setProvider(readyProviders[0].id);
      if (readyProviders[0].id === "elevenlabs") setVoice("21m00Tcm4TlvDq8ikWAM");
      else setVoice("alloy");
    }
  }, [readyProviders, provider]);

  const generate = async () => {
    setErr("");
    const text = prompt.trim();
    if (!text) return;
    setBusy(true);
    try {
      const payload: Record<string, unknown> = { kind: tab, provider };
      if (tab === "image") Object.assign(payload, { prompt: text, size, quality, aspect });
      else if (tab === "voice") Object.assign(payload, { text, voice });
      else Object.assign(payload, { prompt: text, model: videoModel });

      const res = await fetch("/api/studio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = (await res.json()) as { ok?: boolean; error?: string; item?: StudioItem };
      if (!res.ok || j.error) {
        setErr(j.error ?? "generation failed");
        addEvent("STUDIO", `${tab} failed: ${(j.error ?? "").slice(0, 60)}`, "rose");
      } else {
        addEvent("STUDIO", `${tab} ${j.item?.status === "generating" ? "started" : "created"}`, "cyan");
        setPrompt("");
      }
      await loadItems();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    await fetch(`/api/studio?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    setItems((xs) => xs.filter((x) => x.id !== id));
  };

  const tabItems = items.filter((x) => x.kind === tab);
  const activeTab = TABS.find((t) => t.kind === tab)!;
  const ac = ACCENTS[activeTab.accent];
  const promptPlaceholder =
    tab === "image"
      ? "A neon-lit control room at night, isometric, volumetric fog…"
      : tab === "voice"
        ? "Type what you want spoken aloud…"
        : "A drone shot flying over a glowing cyberpunk city at dusk…";

  return (
    <div className="flex flex-col gap-4">
      {!vaultOk && (
        <div role="alert" className="rounded-xl border border-neon-rose/30 bg-neon-rose/10 px-4 py-2.5 font-mono text-xs text-neon-rose">
          Vault not reachable — generated assets are saved into the Obsidian vault, so check VAULT_DIR.
        </div>
      )}

      {/* tab bar */}
      <div className="flex gap-2">
        {TABS.map((t) => {
          const active = t.kind === tab;
          const c = ACCENTS[t.accent];
          const ready = providersFor(t.kind).some((s) => s.configured);
          const Icon = t.icon;
          return (
            <button
              key={t.kind}
              onClick={() => setTab(t.kind)}
              className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold transition-colors"
              style={{
                borderColor: active ? c.base : "var(--color-line)",
                background: active ? c.soft : "transparent",
                color: active ? c.base : "var(--color-ink-dim)",
              }}
            >
              <Icon width={16} height={16} />
              {t.label}
              <StatusOrb accent={ready ? "lime" : "rose"} pulsing={false} size={6} />
            </button>
          );
        })}
      </div>

      {/* composer */}
      <Panel title={`${activeTab.label} Studio`} right={<span className="font-mono text-[10px] text-ink-faint">saved to Agentic OS/Studio</span>}>
        <div className="flex flex-col gap-3 p-5">
          {err && (
            <div role="alert" className="rounded-lg border border-neon-rose/30 bg-neon-rose/10 px-3 py-2 font-mono text-xs text-neon-rose">
              {err}
            </div>
          )}

          {readyProviders.length === 0 ? (
            <div className="flex flex-col items-start gap-2 rounded-xl border border-dashed border-line bg-white/[0.02] p-6">
              <p className="text-sm font-semibold text-ink">No {activeTab.label.toLowerCase()} provider connected</p>
              <p className="text-xs leading-5 text-ink-faint">
                {activeTab.label} generation needs an API key from{" "}
                {providersFor(tab).map((s, i) => (
                  <span key={s.id}>
                    {i > 0 ? " or " : ""}
                    <span className="font-mono text-ink-dim">{s.label}</span>
                  </span>
                ))}
                . Add one and it lights up here.
              </p>
              <Link
                href="/settings"
                className="mt-1 flex cursor-pointer items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold text-black"
                style={{ background: ac.base }}
              >
                🔑 Add a key in Settings
              </Link>
            </div>
          ) : (
            <>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) generate();
                }}
                rows={tab === "voice" ? 4 : 3}
                placeholder={promptPlaceholder}
                className={`${inputCls} resize-none`}
                aria-label={tab === "voice" ? "Text to speak" : "Prompt"}
              />

              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-[8rem]">
                  <label className={labelCls} htmlFor="std-provider">PROVIDER</label>
                  <select id="std-provider" value={provider} onChange={(e) => setProvider(e.target.value)} className={`${inputCls} cursor-pointer`}>
                    {readyProviders.map((p) => (
                      <option key={p.id} value={p.id}>{p.label}</option>
                    ))}
                  </select>
                </div>

                {tab === "image" && provider === "openai" && (
                  <>
                    <div className="min-w-[8rem]">
                      <label className={labelCls} htmlFor="std-size">SIZE</label>
                      <select id="std-size" value={size} onChange={(e) => setSize(e.target.value)} className={`${inputCls} cursor-pointer`}>
                        {IMAGE_SIZES.map((s) => (
                          <option key={s.v} value={s.v}>{s.label} · {s.v}</option>
                        ))}
                      </select>
                    </div>
                    <div className="min-w-[7rem]">
                      <label className={labelCls} htmlFor="std-quality">QUALITY</label>
                      <select id="std-quality" value={quality} onChange={(e) => setQuality(e.target.value)} className={`${inputCls} cursor-pointer`}>
                        {IMAGE_QUALITY.map((q) => (
                          <option key={q} value={q}>{q}</option>
                        ))}
                      </select>
                    </div>
                  </>
                )}
                {tab === "image" && provider === "google" && (
                  <div className="min-w-[9rem]">
                    <label className={labelCls} htmlFor="std-aspect">ASPECT RATIO</label>
                    <select id="std-aspect" value={aspect} onChange={(e) => setAspect(e.target.value)} className={`${inputCls} cursor-pointer`}>
                      {GEMINI_ASPECTS.map((a) => (
                        <option key={a.v} value={a.v}>{a.label} · {a.v}</option>
                      ))}
                    </select>
                  </div>
                )}

                {tab === "voice" && provider === "openai" && (
                  <div className="min-w-[8rem]">
                    <label className={labelCls} htmlFor="std-voice">VOICE</label>
                    <select id="std-voice" value={voice} onChange={(e) => setVoice(e.target.value)} className={`${inputCls} cursor-pointer`}>
                      {OPENAI_VOICES.map((v) => (
                        <option key={v} value={v}>{v}</option>
                      ))}
                    </select>
                  </div>
                )}
                {tab === "voice" && provider === "elevenlabs" && (
                  <div className="min-w-[14rem] flex-1">
                    <label className={labelCls} htmlFor="std-voiceid">VOICE ID <span className="normal-case text-ink-faint">(from your ElevenLabs voice library)</span></label>
                    <input id="std-voiceid" value={voice} onChange={(e) => setVoice(e.target.value)} placeholder="21m00Tcm4TlvDq8ikWAM" className={inputCls} />
                  </div>
                )}

                {tab === "video" && (
                  <div className="min-w-[16rem] flex-1">
                    <label className={labelCls} htmlFor="std-vmodel">REPLICATE MODEL</label>
                    <input id="std-vmodel" value={videoModel} onChange={(e) => setVideoModel(e.target.value)} placeholder="minimax/video-01" className={inputCls} />
                  </div>
                )}

                <motion.button
                  whileTap={{ scale: 0.96 }}
                  onClick={generate}
                  disabled={busy || !prompt.trim()}
                  className="ml-auto flex h-10 cursor-pointer items-center gap-2 rounded-lg px-5 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-35"
                  style={{ background: ac.base }}
                >
                  <IconRocket width={15} height={15} />
                  {busy ? "Working…" : tab === "video" ? "Generate (async)" : "Generate"}
                </motion.button>
              </div>
              {tab === "video" && (
                <p className="text-[11px] leading-4 text-ink-faint">
                  Video renders on Replicate&apos;s servers and can take minutes — it appears below as{" "}
                  <span className="text-neon-amber">generating</span> and fills in when done. Billed per second of compute.
                </p>
              )}
            </>
          )}
        </div>
      </Panel>

      {/* gallery */}
      <Panel title={`${activeTab.label} Gallery`} delay={0.05} right={<span className="font-mono text-[10px] text-ink-faint">{tabItems.length} item{tabItems.length === 1 ? "" : "s"}</span>}>
        <div className="p-5">
          {tabItems.length === 0 ? (
            <EmptyState accent="magenta" title="Gallery empty" hint={`Generate your first ${tab} above — outputs are saved to the vault.`} />
          ) : (
            <div className={tab === "voice" ? "flex flex-col gap-3" : "grid grid-cols-2 gap-4 md:grid-cols-3"}>
              {tabItems.map((item) => (
                <div key={item.id} className="flex flex-col overflow-hidden rounded-xl border border-line bg-white/[0.02]">
                  {/* media */}
                  {item.status === "done" && item.kind === "image" && (
                    <a href={`/api/studio/media?id=${item.id}`} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/studio/media?id=${item.id}`} alt={item.prompt} className="aspect-square w-full object-cover" />
                    </a>
                  )}
                  {item.status === "done" && item.kind === "voice" && (
                    <audio controls preload="none" src={`/api/studio/media?id=${item.id}`} className="w-full px-3 pt-3" />
                  )}
                  {item.status === "done" && item.kind === "video" && (
                    <video controls preload="metadata" src={`/api/studio/media?id=${item.id}`} className="aspect-video w-full bg-black object-contain" />
                  )}
                  {item.status === "generating" && (
                    <div className="flex aspect-square w-full items-center justify-center bg-white/[0.02]">
                      <div className="flex flex-col items-center gap-2 text-ink-faint">
                        <motion.span animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1.6, ease: "linear" }}>
                          <IconSpark width={22} height={22} />
                        </motion.span>
                        <span className="font-mono text-[10px] tracking-wide text-neon-amber">generating…</span>
                      </div>
                    </div>
                  )}
                  {item.status === "error" && (
                    <div className="flex min-h-[6rem] w-full items-center justify-center bg-neon-rose/5 p-3">
                      <span className="font-mono text-[10px] leading-4 text-neon-rose">{item.error ?? "failed"}</span>
                    </div>
                  )}

                  {/* meta row */}
                  <div className="flex flex-col gap-1.5 p-3">
                    <p className="line-clamp-2 text-[11px] leading-4 text-ink-dim">{item.prompt}</p>
                    <div className="flex items-center gap-2 font-mono text-[9px] text-ink-faint">
                      <span className="rounded bg-white/[0.05] px-1.5 py-0.5">{item.provider}</span>
                      {item.meta.size && <span>{item.meta.size}</span>}
                      {item.meta.voice && <span>{item.meta.voice}</span>}
                      {item.meta.bytes ? <span>{bytesLabel(item.meta.bytes)}</span> : null}
                      <div className="ml-auto flex items-center gap-1">
                        {item.status === "done" && (
                          <a
                            href={`/api/studio/media?id=${item.id}`}
                            download
                            aria-label="Download"
                            className="cursor-pointer rounded p-1 text-ink-faint transition-colors hover:bg-white/[0.06] hover:text-neon-cyan"
                          >
                            ↓
                          </a>
                        )}
                        <button
                          onClick={() => remove(item.id)}
                          aria-label="Delete"
                          className="cursor-pointer rounded p-1 text-ink-faint transition-colors hover:bg-white/[0.06] hover:text-neon-rose"
                        >
                          <IconTrash width={12} height={12} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}
