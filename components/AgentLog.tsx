"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ACCENTS } from "@/lib/accents";
import Panel from "./ui/Panel";
import { useMission } from "./store";

/** Per-agent activity log — the global event stream filtered to one agent. */
export default function AgentLog({ source, delay = 0.15 }: { source: string; delay?: number }) {
  const { events } = useMission();
  const mine = events.filter((e) => e.source === source.toUpperCase()).slice(0, 30);

  return (
    <Panel title="Activity Log" delay={delay}>
      <div className="max-h-64 overflow-y-auto p-3">
        {mine.length === 0 && (
          <p className="px-2 py-4 text-center font-mono text-[10px] text-ink-faint">No activity yet this session.</p>
        )}
        <ul className="flex flex-col gap-1">
          <AnimatePresence initial={false}>
            {mine.map((e) => {
              const c = ACCENTS[e.accent];
              return (
                <motion.li
                  key={e.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  className="flex items-baseline gap-2 rounded px-1.5 py-0.5 font-mono text-[10.5px] leading-5"
                >
                  <span className="shrink-0 tabular-nums text-ink-faint">
                    {new Date(e.ts).toLocaleTimeString("en-US", { hour12: false })}
                  </span>
                  <span aria-hidden className="mt-1 h-1.5 w-1.5 shrink-0 self-center rounded-full" style={{ background: c.base }} />
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
