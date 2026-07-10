"use client";

import { AnimatePresence, motion } from "framer-motion";
import Avatar from "./Avatar";
import { useMission } from "./store";
import { IconCheck, IconStop } from "./icons";

/** Pending agent-requested actions, awaiting your sign-off. Rendered globally. */
export default function ApprovalsBar() {
  const { pendingApprovals, resolveApproval, registry } = useMission();

  return (
    <AnimatePresence>
      {pendingApprovals.map((a) => {
        const llm = registry.llms.find((l) => l.id === a.source);
        return (
          <motion.div
            key={a.id}
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8 }}
            role="alertdialog"
            aria-label={`${a.source} requests a mission`}
            className="panel flex items-center gap-3 border-neon-amber/40 px-4 py-3"
          >
            <Avatar
              kind={a.source === "claude" || a.source === "openclaw" || a.source === "hermes" ? (a.source as "claude") : undefined}
              name={a.source}
              accent={llm?.accent ?? "amber"}
              size={30}
            />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-neon-amber">
                {a.source} wants to launch a background mission
              </p>
              <p className="mt-0.5 truncate font-mono text-[11px] text-ink-dim" title={a.payload}>
                {a.payload}
              </p>
            </div>
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => resolveApproval(a.id, true)}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-neon-lime px-3 py-2 text-xs font-bold text-black"
            >
              <IconCheck width={13} height={13} /> Approve
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => resolveApproval(a.id, false)}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-neon-rose/40 bg-neon-rose/10 px-3 py-2 text-xs font-semibold text-neon-rose"
            >
              <IconStop width={13} height={13} /> Reject
            </motion.button>
          </motion.div>
        );
      })}
    </AnimatePresence>
  );
}
