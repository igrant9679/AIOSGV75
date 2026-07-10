"use client";

import { useCallback, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { ACCENTS, type Accent } from "@/lib/accents";
import MicButton, { type MicState } from "../MicButton";
import { IconSend, IconStop } from "../icons";

/** Chat composer: auto-sizing textarea, native dictation mic, send/stop. */
export default function Composer({
  accent,
  placeholder,
  busy,
  disabled = false,
  onSend,
  onStop,
  toolbar,
}: {
  accent: Accent;
  placeholder: string;
  busy: boolean;
  disabled?: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  toolbar?: ReactNode;
}) {
  const c = ACCENTS[accent];
  const [text, setText] = useState("");
  const [mic, setMic] = useState<MicState>({ listening: false, interim: "" });

  const appendFinal = useCallback((phrase: string) => {
    if (!phrase) return;
    setText((prev) => (prev ? `${prev.replace(/\s+$/, "")} ${phrase}` : phrase));
  }, []);

  const send = () => {
    const t = text.trim();
    if (!t || busy || disabled) return;
    setText("");
    onSend(t);
  };

  return (
    <div className="border-t border-line px-4 py-3">
      {toolbar && <div className="mb-2.5 flex flex-wrap items-center gap-2">{toolbar}</div>}

      <div
        className="flex items-end gap-1.5 rounded-2xl border border-line bg-panel-2 p-1.5 transition-colors focus-within:border-line-bright"
        style={mic.listening ? { borderColor: ACCENTS.rose.border } : undefined}
      >
        <textarea
          value={mic.listening && mic.interim ? `${text ? text + " " : ""}${mic.interim}` : text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={Math.min(5, Math.max(1, text.split("\n").length))}
          placeholder={mic.listening ? "Listening…" : placeholder}
          aria-label={placeholder}
          className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-3 py-2 text-[13.5px] leading-6 text-ink outline-none placeholder:text-ink-faint"
        />

        <MicButton onFinal={appendFinal} onState={setMic} />

        {busy ? (
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={onStop}
            aria-label="Stop generation"
            className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-neon-rose/15 text-neon-rose transition-colors hover:bg-neon-rose/25"
          >
            <IconStop />
          </motion.button>
        ) : (
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={send}
            disabled={!text.trim() || disabled}
            aria-label="Send message"
            className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-xl text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-30"
            style={{ background: `linear-gradient(135deg, ${c.gradFrom}, ${c.base})` }}
          >
            <IconSend width={16} height={16} />
          </motion.button>
        )}
      </div>

      {mic.listening && (
        <p className="mt-1.5 px-2 font-mono text-[10px] text-neon-rose" aria-live="polite">
          ● Listening — click the mic again to stop
        </p>
      )}
    </div>
  );
}
