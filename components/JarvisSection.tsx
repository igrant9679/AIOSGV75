"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { ACCENTS } from "@/lib/accents";
import { useSpeech } from "@/lib/useSpeech";
import { cleanForSpeech, ttsSupported } from "@/lib/tts";
import Panel from "./ui/Panel";
import StatusOrb from "./ui/StatusOrb";
import EmptyState from "./ui/EmptyState";

const EQ_BARS = 24;

/** Simulated voice bars — fallback when the mic stream isn't available (TTS playback, denied mic). */
function Equalizer({ color }: { color: string }) {
  return (
    <div className="flex h-6 items-center gap-[3px]" aria-hidden>
      {Array.from({ length: EQ_BARS }, (_, i) => (
        <span
          key={i}
          className="eq-bar w-[3px] rounded-full"
          style={{ background: color, animationDelay: `${(i % 7) * 0.11}s`, animationDuration: `${0.5 + (i % 5) * 0.12}s` }}
        />
      ))}
    </div>
  );
}

/**
 * Real-amplitude voice bars — taps the mic via Web Audio (getUserMedia →
 * AnalyserNode) and drives bar heights from the live frequency spectrum,
 * bypassing React state (direct style writes in a rAF loop). Falls back to the
 * simulated Equalizer if the mic stream can't be opened.
 */
function LiveEqualizer({ color }: { color: string }) {
  const barsRef = useRef<(HTMLSpanElement | null)[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let raf = 0;
    let ctx: AudioContext | null = null;
    let stream: MediaStream | null = null;
    let alive = true;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (!alive) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 128; // 64 bins — plenty for 24 bars
        analyser.smoothingTimeConstant = 0.75;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          if (!alive) return;
          analyser.getByteFrequencyData(data);
          for (let i = 0; i < EQ_BARS; i++) {
            const el = barsRef.current[i];
            if (!el) continue;
            // voice energy lives in the low bins — spread bars across the lower half
            const v = data[2 + Math.floor((i / EQ_BARS) * (data.length / 2))] / 255;
            el.style.height = `${Math.max(10, Math.round(v * 100))}%`;
          }
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      ctx?.close().catch(() => {});
    };
  }, []);

  if (failed) return <Equalizer color={color} />;
  return (
    <div className="flex h-6 items-center gap-[3px]" aria-hidden>
      {Array.from({ length: EQ_BARS }, (_, i) => (
        <span
          key={i}
          ref={(el) => {
            barsRef.current[i] = el;
          }}
          className="w-[3px] rounded-full transition-[height] duration-75"
          style={{ background: color, height: "10%" }}
        />
      ))}
    </div>
  );
}

/**
 * JARVIS — a voice command center for the whole OS. Speak; it navigates,
 * answers via the Auto agent, and talks back. Web Speech API, no keys.
 */

const NAV: { words: string[]; href: string; label: string }[] = [
  { words: ["overview", "home", "mission control", "dashboard"], href: "/", label: "Overview" },
  { words: ["mastermind", "round table", "the room"], href: "/mastermind", label: "Mastermind" },
  { words: ["builds", "games", "the shelf", "game studio"], href: "/builds", label: "Builds" },
  { words: ["pipeline", "inbox"], href: "/pipeline", label: "Pipeline" },
  { words: ["watcher", "youtube", "trends", "astros", "radar"], href: "/watcher", label: "YouTube Watcher" },
  { words: ["tasks", "kanban", "board", "orchestrator"], href: "/tasks", label: "Tasks" },
  { words: ["schedule", "cron", "calendar"], href: "/schedule", label: "Schedule" },
  { words: ["library", "documents", "docs"], href: "/library", label: "Library" },
  { words: ["graph", "knowledge graph"], href: "/graph", label: "Graph" },
  { words: ["arena", "battles"], href: "/arena", label: "Arena" },
  { words: ["analytics", "cost", "usage"], href: "/analytics", label: "Analytics" },
  { words: ["memory", "the brain"], href: "/memory", label: "Memory" },
  { words: ["goals"], href: "/goals", label: "Goals" },
  { words: ["hermes lab", "goal mode", "control room"], href: "/hermes-lab", label: "Hermes Lab" },
  { words: ["settings"], href: "/settings", label: "Settings" },
  { words: ["guide", "manual", "help"], href: "/guide", label: "Guide" },
];

const BOOT = ["NEURAL LINK", "VOICE CORE", "AGENT MESH", "REACTOR"];

interface Line {
  who: "you" | "jarvis";
  text: string;
}

export default function JarvisSection() {
  const router = useRouter();
  const [booted, setBooted] = useState(false);
  const [bootStep, setBootStep] = useState(0);
  const [lines, setLines] = useState<Line[]>([]);
  const [thinking, setThinking] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [wakeWord, setWakeWord] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceName, setVoiceName] = useState<string>("");
  const [typed, setTyped] = useState("");
  const feedRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);

  // boot sequence
  useEffect(() => {
    if (booted) return;
    if (bootStep < BOOT.length) {
      const t = setTimeout(() => setBootStep((s) => s + 1), 420);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setBooted(true), 500);
    return () => clearTimeout(t);
  }, [bootStep, booted]);

  // voices
  useEffect(() => {
    if (!ttsSupported()) return;
    const loadVoices = () => {
      const vs = window.speechSynthesis.getVoices();
      setVoices(vs);
      if (!voiceName && vs.length) {
        const pref = vs.find((v) => /daniel|male|google uk english male|jarvis/i.test(v.name)) ?? vs.find((v) => v.lang.startsWith("en")) ?? vs[0];
        setVoiceName(pref?.name ?? "");
      }
    };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const say = useCallback(
    (text: string) => {
      if (!ttsSupported()) return;
      const cleaned = cleanForSpeech(text).slice(0, 3000);
      if (!cleaned) return;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(cleaned);
      const v = voices.find((x) => x.name === voiceName);
      if (v) u.voice = v;
      u.rate = 1.03;
      u.onstart = () => setSpeaking(true);
      u.onend = () => setSpeaking(false);
      window.speechSynthesis.speak(u);
    },
    [voices, voiceName]
  );

  const handle = useCallback(
    async (raw: string) => {
      let command = raw.trim();
      if (!command || busyRef.current) return;
      // wake-word gate
      if (wakeWord) {
        const m = command.toLowerCase().match(/\b(jarvis|hey jarvis|computer)\b(.*)/);
        if (!m) return;
        command = m[2].trim();
        if (!command) {
          say("Yes?");
          return;
        }
      }
      setLines((l) => [...l, { who: "you", text: command }]);

      // navigation intent
      const lc = command.toLowerCase();
      if (/^(go to|open|show|take me to|navigate to)\b/.test(lc)) {
        const target = NAV.find((n) => n.words.some((w) => lc.includes(w)));
        if (target) {
          const reply = `Opening ${target.label}.`;
          setLines((l) => [...l, { who: "jarvis", text: reply }]);
          say(reply);
          router.push(target.href);
          return;
        }
      }

      // otherwise: ask the Auto agent and speak the answer
      busyRef.current = true;
      setThinking(true);
      try {
        const res = await fetch("/api/auto", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: `You are JARVIS, a concise spoken assistant for Idris's Mission Control OS. Answer in 1-3 sentences, plain speech, no markdown. Question: ${command}`,
          }),
        });
        const json = (await res.json()) as { text?: string; error?: string; routedTo?: string };
        const reply = json.error ? "I hit an error reaching the agent." : json.text ?? "No response.";
        setLines((l) => [...l, { who: "jarvis", text: reply }]);
        say(reply);
      } catch {
        setLines((l) => [...l, { who: "jarvis", text: "Connection failed." }]);
      } finally {
        busyRef.current = false;
        setThinking(false);
      }
    },
    [router, say, wakeWord]
  );

  const { supported, listening, interim, toggle } = useSpeech(handle);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" });
  }, [lines, interim]);

  const c = ACCENTS.cyan;
  const reactor = speaking ? ACCENTS.magenta : listening ? ACCENTS.lime : ACCENTS.cyan;

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Hermes-JARVIS">
        <div className="relative flex min-h-[280px] flex-col items-center justify-center gap-4 overflow-hidden p-8">
          {/* arc reactor — glow + counter-rotating rings around a pulsing core */}
          <motion.div
            aria-hidden
            className="pointer-events-none absolute h-64 w-64 rounded-full"
            style={{ background: `radial-gradient(circle, ${reactor.soft}, transparent 65%)` }}
            animate={{ scale: speaking ? [1, 1.15, 1] : listening ? [1, 1.06, 1] : 1, opacity: booted ? 1 : 0.3 }}
            transition={{ duration: speaking ? 0.6 : 2, repeat: Infinity }}
          />
          <svg aria-hidden viewBox="0 0 200 200" className="pointer-events-none absolute h-52 w-52" style={{ opacity: booted ? 0.9 : 0.2 }}>
            <g className="logo-orbit" style={{ animationDuration: listening || speaking ? "6s" : "22s" }}>
              <circle cx="100" cy="100" r="88" fill="none" strokeWidth="2" strokeDasharray="40 18" strokeLinecap="round" style={{ stroke: reactor.base }} opacity="0.55" />
            </g>
            <g className="logo-orbit-rev" style={{ animationDuration: listening || speaking ? "4s" : "14s" }}>
              <circle cx="100" cy="100" r="70" fill="none" strokeWidth="1" strokeDasharray="4 8" style={{ stroke: reactor.base }} opacity="0.5" />
            </g>
            <circle cx="100" cy="100" r="52" fill="none" strokeWidth="0.75" style={{ stroke: reactor.base }} opacity="0.35" />
            <circle cx="100" cy="100" r="7" className="logo-core" style={{ fill: reactor.base }} />
          </svg>
          <AnimatePresence mode="wait">
            {!booted ? (
              <motion.div key="boot" exit={{ opacity: 0 }} className="z-10 flex flex-col items-center gap-2">
                <p className="font-mono text-2xl font-bold tracking-[0.3em]" style={{ color: c.base }}>
                  J A R V I S
                </p>
                <div className="flex flex-col gap-1 pt-2">
                  {BOOT.map((b, i) => (
                    <p key={b} className="font-mono text-[11px] tracking-[0.14em]" style={{ color: i < bootStep ? ACCENTS.lime.base : "var(--color-ink-faint)" }}>
                      {b} … {i < bootStep ? "✓" : "—"}
                    </p>
                  ))}
                </div>
              </motion.div>
            ) : (
              <motion.div key="online" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="z-10 flex flex-col items-center gap-3">
                <div className="flex items-center gap-2 font-mono text-[11px] tracking-[0.2em]" style={{ color: c.base }}>
                  <StatusOrb accent={speaking ? "magenta" : listening ? "lime" : "cyan"} pulsing={listening || speaking} size={8} />
                  {speaking ? "SPEAKING" : listening ? "LISTENING" : "STANDING BY"}
                </div>
                {listening ? <LiveEqualizer color={reactor.base} /> : speaking ? <Equalizer color={reactor.base} /> : null}
                {interim && <p className="max-w-md text-center text-sm text-ink-dim">{interim}</p>}
                {!supported && <p className="text-center text-xs text-neon-rose">Voice needs Chrome or Edge (Web Speech API). You can still type below.</p>}
                <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                  <button
                    onClick={toggle}
                    disabled={!supported}
                    className="cursor-pointer rounded-full px-5 py-2 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-35"
                    style={{ background: listening ? ACCENTS.rose.base : c.base }}
                  >
                    {listening ? "◼ Stop listening" : "◉ Start listening"}
                  </button>
                  <label className="flex cursor-pointer items-center gap-1.5 rounded-full border border-line px-3 py-2 font-mono text-[10px] text-ink-dim">
                    <input type="checkbox" checked={wakeWord} onChange={(e) => setWakeWord(e.target.checked)} className="cursor-pointer accent-current" />
                    WAKE WORD &quot;JARVIS&quot;
                  </label>
                  {voices.length > 0 && (
                    <select
                      value={voiceName}
                      onChange={(e) => setVoiceName(e.target.value)}
                      className="cursor-pointer rounded-full border border-line bg-panel-2 px-3 py-2 font-mono text-[10px] text-ink-dim outline-none"
                    >
                      {voices.filter((v) => v.lang.startsWith("en")).map((v) => (
                        <option key={v.name} value={v.name}>{v.name.slice(0, 28)}</option>
                      ))}
                    </select>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </Panel>

      <Panel title="Transcript" right={<span className="font-mono text-[10px] text-ink-faint">say &quot;go to watcher&quot; · or ask anything</span>} delay={0.06}>
        <div className="flex h-[360px] flex-col">
          <div ref={feedRef} className="flex-1 space-y-3 overflow-y-auto p-4">
            {lines.length === 0 && (
              <div className="flex flex-col items-center gap-3 py-8">
                <EmptyState accent="cyan" title="Standing by" hint="Start listening and speak — or tap a command to try one:" />
                <div className="flex flex-wrap justify-center gap-2">
                  {["open the pipeline", "go to arena", "what should I build next?"].map((cmd) => (
                    <button
                      key={cmd}
                      onClick={() => handle(cmd)}
                      className="cursor-pointer rounded-full border border-line px-3 py-1.5 font-mono text-[10.5px] text-ink-dim transition-colors hover:border-line-bright hover:text-neon-cyan"
                    >
                      “{cmd}”
                    </button>
                  ))}
                </div>
              </div>
            )}
            {lines.map((l, i) => (
              <div key={i} className={l.who === "you" ? "flex justify-end" : "flex gap-2"}>
                <div
                  className="max-w-[80%] rounded-2xl border border-line px-4 py-2 text-sm"
                  style={l.who === "jarvis" ? { background: c.soft, color: "var(--color-ink)" } : { background: "rgba(255,255,255,0.04)" }}
                >
                  <p className="pb-0.5 font-mono text-[9px] tracking-[0.16em]" style={{ color: l.who === "jarvis" ? c.base : "var(--color-ink-faint)" }}>
                    {l.who === "jarvis" ? "JARVIS" : "YOU"}
                  </p>
                  <p className="text-ink">{l.text}</p>
                </div>
              </div>
            ))}
            {thinking && <p className="pl-2 font-mono text-[11px] text-ink-faint">JARVIS is thinking…</p>}
          </div>
          <div className="flex items-center gap-2 border-t border-line p-3">
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && typed.trim()) {
                  handle(typed);
                  setTyped("");
                }
              }}
              placeholder="…or type a command for JARVIS and press Enter"
              className="h-10 flex-1 rounded-lg border border-line bg-panel-2 px-3 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-line-bright"
            />
            <button
              onClick={() => {
                if (typed.trim()) {
                  handle(typed);
                  setTyped("");
                }
              }}
              className="cursor-pointer rounded-lg px-4 py-2 text-sm font-semibold text-black"
              style={{ background: c.base }}
            >
              Send
            </button>
          </div>
        </div>
      </Panel>
    </div>
  );
}
