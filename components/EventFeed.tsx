"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ACCENTS } from "@/lib/accents";
import Panel from "./ui/Panel";
import { useMission } from "./store";

export default function EventFeed({ className = "", delay = 0 }: { className?: string; delay?: number }) {
  const { events } = useMission();

  return (
    <Panel title="Event Stream" className={className} delay={delay}>
      <div className="scanlines relative max-h-72 overflow-y-auto p-3">
        {events.length === 0 && (
          <p className="px-2 py-6 text-center font-mono text-xs text-ink-faint">
            Awaiting first telemetry pulse…
          </p>
        )}
        <ul className="flex flex-col gap-1.5">
          <AnimatePresence initial={false}>
            {events.map((e) => {
              const c = ACCENTS[e.accent];
              return (
                <motion.li
                  key={e.id}
                  initial={{ opacity: 0, x: -14 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.25 }}
                  className="flex items-baseline gap-2 rounded px-2 py-1 font-mono text-[11px] leading-5"
                >
                  <span className="tabular-nums text-ink-faint">
                    {new Date(e.ts).toLocaleTimeString("en-US", { hour12: false })}
                  </span>
                  <span
                    className="shrink-0 rounded px-1.5 py-px text-[9px] font-bold tracking-[0.14em]"
                    style={{ color: c.base, background: c.soft }}
                  >
                    {e.source}
                  </span>
                  <span className="min-w-0 break-words text-ink-dim">{e.text}</span>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      </div>
    </Panel>
  );
}
