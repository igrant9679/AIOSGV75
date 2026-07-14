"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

const SHORTCUTS: { keys: string[]; what: string }[] = [
  { keys: ["Ctrl", "K"], what: "Command palette — jump to any page or agent" },
  { keys: ["?"], what: "This overlay" },
  { keys: ["Esc"], what: "Close palette / overlay / dialogs" },
  { keys: ["Enter"], what: "Send message · add task (in composers)" },
];

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
}

/** "?" opens a keyboard-shortcut reference; Esc or click-away closes it. */
export default function ShortcutsOverlay() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "?" && !isTyping(e.target) && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Keyboard shortcuts"
            initial={{ opacity: 0, scale: 0.94, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="panel w-[420px] max-w-[92vw] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between border-b border-line px-5 py-3">
              <h2 className="panel-title">Keyboard Shortcuts</h2>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="cursor-pointer rounded p-1 font-mono text-[11px] text-ink-faint hover:text-ink"
              >
                ✕
              </button>
            </header>
            <div className="flex flex-col gap-2.5 p-5">
              {SHORTCUTS.map((s) => (
                <div key={s.what} className="flex items-center justify-between gap-4">
                  <span className="flex shrink-0 gap-1">
                    {s.keys.map((k) => (
                      <kbd
                        key={k}
                        className="rounded-md border border-line bg-panel-2 px-2 py-0.5 font-mono text-[11px] font-bold text-neon-cyan"
                      >
                        {k}
                      </kbd>
                    ))}
                  </span>
                  <span className="min-w-0 flex-1 text-right text-[11.5px] text-ink-dim">{s.what}</span>
                </div>
              ))}
              <p className="pt-2 text-center font-mono text-[9.5px] tracking-[0.18em] text-ink-faint">
                PRESS ? ANYWHERE TO TOGGLE
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
