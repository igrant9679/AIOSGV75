"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import StatusOrb from "./ui/StatusOrb";
import { IconSun, IconMoon } from "./icons";
import { useMission } from "./store";

export default function Header() {
  const { system, busy } = useMission();
  const claudeBusy = Boolean(busy.claude);
  const [clock, setClock] = useState<string>("");
  const [theme, setTheme] = useState("dark");

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme ?? "dark");
  }, []);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("mc-theme", next);
    } catch {
      /* private mode */
    }
  };

  useEffect(() => {
    const tick = () =>
      setClock(
        new Date().toLocaleTimeString("en-US", { hour12: false }) +
          " · " +
          new Date().toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" }),
      );
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, []);

  const bridgeOnline = Boolean(system?.claudeVersion);

  return (
    <motion.header
      initial={{ opacity: 0, y: -16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="panel flex items-center justify-between gap-4 overflow-hidden px-5 py-3"
    >
      <div className="flex items-center gap-3">
        <div className="relative h-9 w-9">
          <div
            className="absolute inset-0 rounded-lg"
            style={{
              background: "conic-gradient(from 180deg, #22d3ee, #e879f9, #a78bfa, #22d3ee)",
              filter: "blur(10px)",
              opacity: 0.6,
            }}
          />
          <div
            className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-line font-mono text-sm font-bold text-neon-cyan"
            style={{ background: "rgba(14,17,34,0.66)", backdropFilter: "blur(16px)" }}
          >
            MC
          </div>
        </div>
        <div>
          <h1 className="font-display text-lg font-bold tracking-[0.18em] text-ink">
            MISSION<span className="text-neon-cyan text-glow-cyan">CONTROL</span>
          </h1>
          <p className="font-mono text-[10px] tracking-[0.28em] text-ink-faint">
            LOCAL AI OPERATIONS DECK
          </p>
        </div>
      </div>

      <div className="flex items-center gap-5">
        <div className="hidden items-center gap-2 md:flex">
          <StatusOrb accent={bridgeOnline ? (claudeBusy ? "amber" : "lime") : "rose"} />
          <span className="font-mono text-[11px] text-ink-dim">
            {bridgeOnline
              ? claudeBusy
                ? "CLAUDE BRIDGE // ACTIVE TRANSMISSION"
                : `CLAUDE BRIDGE // v${system?.claudeVersion?.split(" ")[0]}`
              : "CLAUDE BRIDGE // SEARCHING"}
          </span>
        </div>
        <div className="font-mono text-[11px] tabular-nums text-ink-dim" suppressHydrationWarning>
          {clock}
        </div>
        <button
          onClick={toggleTheme}
          aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          title={theme === "dark" ? "Light mode" : "Dark mode"}
          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-line text-ink-dim transition-colors hover:border-line-bright hover:text-ink"
        >
          {theme === "dark" ? <IconSun width={15} height={15} /> : <IconMoon width={15} height={15} />}
        </button>
      </div>
    </motion.header>
  );
}
