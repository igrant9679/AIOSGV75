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
        {/* Orbital command emblem: gradient ring + counter-rotating orbit carrying
            satellites (the fleet) around a pulsing core (the deck). */}
        <div className="relative h-10 w-10">
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background:
                "conic-gradient(from 180deg, var(--ac-cyan), var(--ac-magenta), var(--ac-violet), var(--ac-cyan))",
              filter: "blur(12px)",
              opacity: 0.5,
            }}
          />
          <svg viewBox="0 0 40 40" className="relative h-10 w-10" aria-hidden>
            <defs>
              <linearGradient id="mc-emblem" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" style={{ stopColor: "var(--ac-cyan)" }} />
                <stop offset="50%" style={{ stopColor: "var(--ac-violet)" }} />
                <stop offset="100%" style={{ stopColor: "var(--ac-magenta)" }} />
              </linearGradient>
            </defs>
            <g className="logo-orbit">
              <circle
                cx="20"
                cy="20"
                r="17"
                fill="none"
                stroke="url(#mc-emblem)"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeDasharray="80 27"
              />
              <circle cx="20" cy="3" r="2" style={{ fill: "var(--ac-cyan)" }} />
            </g>
            <g className="logo-orbit-rev">
              <circle
                cx="20"
                cy="20"
                r="12"
                fill="none"
                strokeWidth="1"
                strokeDasharray="3 5"
                opacity="0.7"
                style={{ stroke: "var(--ac-violet)" }}
              />
              <circle cx="32" cy="20" r="1.6" style={{ fill: "var(--ac-magenta)" }} />
              <circle cx="8" cy="20" r="1.2" style={{ fill: "var(--ac-lime)" }} />
            </g>
            <circle
              cx="20"
              cy="20"
              r="7.5"
              fill="none"
              strokeWidth="0.8"
              opacity="0.5"
              style={{ stroke: "var(--ac-cyan)" }}
            />
            <circle cx="20" cy="20" r="4.5" fill="url(#mc-emblem)" className="logo-core" />
          </svg>
        </div>
        <div>
          <h1 className="font-display text-lg font-bold tracking-[0.18em]">
            <span className="logo-title">MISSIONCONTROL</span>
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
