"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { ConsoleEntry } from "@/lib/types";
import { ACCENTS, type Accent } from "@/lib/accents";
import Avatar, { type AvatarKind } from "../Avatar";
import { IconTerminal } from "../icons";

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
    <div className={`mb-3 flex items-end gap-2.5 ${isUser ? "flex-row-reverse" : ""}`}>
      <Avatar kind={isUser ? "user" : agent} name={agentName} accent={accent} size={32} />
      <div
        className={`max-w-[78%] whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-[13.5px] leading-6 ${
          isUser
            ? "rounded-br-md text-white"
            : isError
              ? "rounded-bl-md border border-neon-rose/30 bg-neon-rose/10 text-neon-rose"
              : "rounded-bl-md border border-line bg-white/[0.04] text-ink"
        }`}
        style={isUser ? { background: `linear-gradient(135deg, ${c.gradFrom}, ${c.base}cc)` } : undefined}
      >
        {entry.text || " "}
      </div>
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
      <Avatar kind={agent} name={agentName} accent={accent} size={32} />
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

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [entries, busy]);

  const last = entries[entries.length - 1];
  const showTyping = busy && (!last || last.role !== "assistant" || last.text === "");

  return (
    <div ref={scrollRef} className={`overflow-y-auto px-5 py-4 ${heightClass}`}>
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
