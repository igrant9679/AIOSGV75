"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { ACCENTS } from "@/lib/accents";
import { useMission } from "../store";

/** Where a footer-ticker click lands, by event source tag. */
const SOURCE_HREF: Record<string, string> = {
  TASKS: "/tasks",
  MISSIONS: "/missions",
  ARENA: "/arena",
  GOALS: "/goals",
  JOURNAL: "/journal",
  MEMORY: "/memory",
  VAULT: "/library",
  CLAUDE: "/claude",
  APPROVAL: "/missions",
  SYSTEM: "/",
  ORCH: "/tasks",
  PIPELINE: "/pipeline",
  WATCHER: "/watcher",
  STUDIO: "/studio",
  CONTENT: "/content",
};

/** Latest event as a one-line live ticker (footer). Falls back to the deck tag. */
export default function EventTicker() {
  const { events } = useMission();
  const latest = events[0];

  if (!latest) return <span>MISSION CONTROL · LOCAL DECK</span>;

  const c = ACCENTS[latest.accent];
  return (
    <Link
      href={SOURCE_HREF[latest.source] ?? "/"}
      className="group flex min-w-0 items-center gap-2 transition-colors hover:text-ink-dim"
      title="Jump to source page"
    >
      <span className="relative flex h-1.5 w-1.5 shrink-0">
        <span className="absolute inset-0 animate-ping rounded-full" style={{ background: c.base, opacity: 0.5 }} />
        <span className="relative rounded-full" style={{ background: c.base, width: 6, height: 6 }} />
      </span>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={latest.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.25 }}
          className="flex min-w-0 items-baseline gap-2"
        >
          <span className="shrink-0 font-bold" style={{ color: c.base }}>
            {latest.source}
          </span>
          <span className="truncate normal-case tracking-normal">{latest.text}</span>
        </motion.span>
      </AnimatePresence>
    </Link>
  );
}
