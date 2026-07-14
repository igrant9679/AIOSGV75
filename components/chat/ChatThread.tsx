"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { ConsoleEntry } from "@/lib/types";
import { ACCENTS, type Accent } from "@/lib/accents";
import { speak, stopSpeaking, ttsSupported } from "@/lib/tts";
import { useLocalStorageState } from "@/lib/useLocalStorageState";
import Avatar, { type AvatarKind } from "../Avatar";
import Markdown from "../Markdown";
import { IconTerminal, IconSpeaker } from "../icons";

function Bubble({
  entry,
  agent,
  agentName,
  accent,
}: {
  entry: ConsoleEntry;
  agent?: AvatarKind;
  agentName?: string;
  accent: Accent;
}) {
  const c = ACCENTS[accent];

  if (entry.role === "system") {
    return (
      <div className="my-3 flex items-center gap-3 px-2" role="status">
        <span className="h-px flex-1 bg-line" />
        <span className="font-mono text-[10px] tracking-wide text-ink-faint">{entry.text}</span>
        <span className="h-px flex-1 bg-line" />
      </div>
    );
  }

  if (entry.role === "tool") {
    return (
      <div className="mb-2 ml-11 flex max-w-[85%] items-start gap-2 rounded-xl border border-line bg-white/[0.02] px-3 py-2">
        <IconTerminal width={13} height={13} className="mt-1 shrink-0 text-ink-faint" />
        <pre className="min-w-0 flex-1 whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-ink-dim">
          {entry.text}
        </pre>
      </div>
    );
  }

  const isUser = entry.role === "user";
  const isError = entry.role === "error";

  return (
    <div className={`group mb-3 flex items-end gap-2.5 ${isUser ? "flex-row-reverse" : ""}`}>
      <Avatar kind={isUser ? "user" : agent} name={agentName} accent={accent} size={32} />
      <div
        className={`max-w-[78%] break-words rounded-2xl px-4 py-2.5 text-[13.5px] leading-6 ${
          isUser
            ? "whitespace-pre-wrap rounded-br-md text-white"
            : isError
              ? "whitespace-pre-wrap rounded-bl-md border border-neon-rose/30 bg-neon-rose/10 text-neon-rose"
              : "rounded-bl-md border border-line bg-white/[0.04] text-ink"
        }`}
        style={isUser ? { background: `linear-gradient(135deg, ${c.gradFrom}, ${c.base})`, color: "#fff" } : undefined}
      >
        {!isUser && !isError ? <Markdown>{entry.text || " "}</Markdown> : entry.text || " "}
      </div>
      {!isUser && !isError && ttsSupported() && entry.text && (
        <button
          onClick={() => speak(entry.text)}
          aria-label="Read this reply aloud"
          title="Read aloud"
          className="mb-1 cursor-pointer rounded-lg p-1.5 text-ink-faint opacity-0 transition-all hover:bg-white/[0.06] hover:text-neon-cyan group-hover:opacity-100"
        >
          <IconSpeaker width={14} height={14} />
        </button>
      )}
    </div>
  );
}

export function TypingIndicator({
  agent,
  agentName,
  accent,
}: {
  agent?: AvatarKind;
  agentName?: string;
  accent?: Accent;
}) {
  return (
    <div className="mb-3 flex items-end gap-2.5">
      <Avatar kind={agent} name={agentName} accent={accent} size={32} busy />
      <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-md border border-line bg-white/[0.04] px-4 py-3.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="typing-dot h-1.5 w-1.5 rounded-full bg-ink-dim"
            style={{ animationDelay: `${i * 0.18}s` }}
          />
        ))}
      </div>
    </div>
  );
}

export default function ChatThread({
  entries,
  agent,
  agentName,
  accent,
  busy,
  empty,
  heightClass = "h-[30rem]",
}: {
  entries: ConsoleEntry[];
  agent?: AvatarKind;
  agentName?: string;
  accent: Accent;
  busy: boolean;
  empty: ReactNode;
  heightClass?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoSpeak, setAutoSpeak] = useLocalStorageState<string>("mc-autospeak", "off");
  const [supported, setSupported] = useState(false);
  const spokenRef = useRef<string | null>(null);

  useEffect(() => {
    setSupported(ttsSupported());
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [entries, busy]);

  // voice out: when a run settles, read the newest assistant reply aloud
  useEffect(() => {
    if (busy || autoSpeak !== "on") return;
    const lastAssistant = [...entries].reverse().find((e) => e.role === "assistant" && e.text.trim());
    if (lastAssistant && spokenRef.current !== lastAssistant.id) {
      spokenRef.current = lastAssistant.id;
      speak(lastAssistant.text);
    }
  }, [busy, entries, autoSpeak]);

  const last = entries[entries.length - 1];
  const showTyping = busy && (!last || last.role !== "assistant" || last.text === "");

  return (
    <div ref={scrollRef} className={`relative overflow-y-auto px-5 py-4 ${heightClass}`}>
      {supported && (
        <button
          onClick={() => {
            const next = autoSpeak === "on" ? "off" : "on";
            setAutoSpeak(next);
            if (next === "off") stopSpeaking();
            else {
              // mark current tail as already spoken so the toggle doesn't replay history
              const lastAssistant = [...entries].reverse().find((e) => e.role === "assistant");
              spokenRef.current = lastAssistant?.id ?? null;
            }
          }}
          aria-pressed={autoSpeak === "on"}
          aria-label={autoSpeak === "on" ? "Turn off spoken replies" : "Read replies aloud automatically"}
          title={autoSpeak === "on" ? "Voice replies: on" : "Voice replies: off"}
          className={`sticky left-full top-0 z-10 -mr-1 flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border transition-colors ${
            autoSpeak === "on"
              ? "border-neon-cyan/50 bg-neon-cyan/15 text-neon-cyan"
              : "border-line bg-panel-2/80 text-ink-faint hover:text-ink"
          }`}
        >
          <IconSpeaker width={15} height={15} />
        </button>
      )}
      {entries.length === 0 && !busy && (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-center">{empty}</div>
      )}
      <AnimatePresence initial={false}>
        {entries.map((e) => (
          <motion.div
            key={e.id}
            initial={{ opacity: 0, y: 8, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            <Bubble entry={e} agent={agent} agentName={agentName} accent={accent} />
          </motion.div>
        ))}
        {showTyping && (
          <motion.div key="typing" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <TypingIndicator agent={agent} agentName={agentName} accent={accent} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
