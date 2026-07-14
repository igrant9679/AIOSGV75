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
      className="panel flex items-center justify-between gap-4 px-5 py-3"
    >
      <div className="flex items-center gap-3">
        <div className="relative h-10 w-10">
          <motion.div
            className="absolute inset-0 rounded-xl"
            style={{ background: "conic-gradient(from 140deg, #22d3ee, #a78bfa, #e879f9, #fbbf24, #22d3ee)", filter: "blur(11px)", opacity: 0.75 }}
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 14, ease: "linear" }}
          />
          <div
            className="relative flex h-10 w-10 items-center justify-center rounded-xl"
            style={{ background: "linear-gradient(135deg, #22d3ee 0%, #6366f1 48%, #e879f9 100%)", boxShadow: "0 4px 18px rgba(139,92,246,0.45)" }}
          >
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="white" strokeWidth="1.7" strokeLinecap="round">
              <circle cx="12" cy="12" r="8.5" opacity="0.5" />
              <circle cx="12" cy="12" r="4" />
              <circle cx="12" cy="12" r="1.5" fill="white" stroke="none" />
              <path d="M12 12l6.4-4.6" opacity="0.9" />
            </svg>
          </div>
        </div>
        <div>
          <h1
            className="bg-clip-text font-display text-lg font-black tracking-[0.16em] text-transparent"
            style={{ backgroundImage: "linear-gradient(100deg, var(--ac-cyan), var(--ac-violet), var(--ac-magenta), var(--ac-amber))" }}
          >
            MISSION CONTROL
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
