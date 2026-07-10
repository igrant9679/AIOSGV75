"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ACCENTS } from "@/lib/accents";
import Panel from "./ui/Panel";
import RadarSweep from "./ui/RadarSweep";
import StatusOrb from "./ui/StatusOrb";
import NumberTicker from "./ui/NumberTicker";
import Avatar, { type AvatarKind } from "./Avatar";
import SystemVitals from "./SystemVitals";
import EventFeed from "./EventFeed";
import { useMission } from "./store";

export default function OverviewSection() {
  const { system, agents, claudeStats, busy } = useMission();

  const fleet = [
    {
      id: "claude",
      name: "Claude",
      role: "Primary operator · CLI bridge",
      accent: "violet" as const,
      online: Boolean(system?.claudeVersion),
      busy: Boolean(busy.claude),
      detail: system?.claudeVersion ?? "waking bridge…",
    },
    ...agents.map((a) => ({
      id: a.id,
      name: a.name,
      role: a.tagline,
      accent: a.accent,
      online: a.available,
      busy: Boolean(busy[a.id]),
      detail: a.available ? (a.version ?? "ready") : `'${a.binary}' not found`,
    })),
  ];

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <div className="flex flex-col gap-4 xl:col-span-2">
        <SystemVitals />

        <Panel title="Agent Fleet" delay={0.08}>
          <div className="grid gap-3 p-4 md:grid-cols-3">
            {fleet.map((agent, i) => {
              const c = ACCENTS[agent.accent];
              return (
                <motion.div
                  key={agent.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.12 + i * 0.06 }}
                  whileHover={{ y: -3 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <Link
                    href={`/${agent.id}`}
                    className="block cursor-pointer rounded-2xl border border-line bg-white/[0.02] p-4 transition-colors hover:border-line-bright"
                  >
                    <div className="flex items-center justify-between">
                      <Avatar kind={agent.id as AvatarKind} size={38} />
                      <StatusOrb accent={agent.online ? (agent.busy ? "amber" : "lime") : "rose"} size={8} />
                    </div>
                    <p className="mt-3 text-sm font-semibold tracking-wide" style={{ color: c.base }}>
                      {agent.name}
                    </p>
                    <p className="mt-0.5 text-[11px] leading-4 text-ink-faint">{agent.role}</p>
                    <p className="mt-2 truncate font-mono text-[10px] text-ink-dim">{agent.detail}</p>
                  </Link>
                </motion.div>
              );
            })}
          </div>
        </Panel>

        <EventFeed delay={0.14} />
      </div>

      <div className="flex flex-col gap-4">
        <Panel title="Deep Space Scan" delay={0.1}>
          <div className="p-4">
            <RadarSweep size={230} />
            <p className="mt-2 text-center font-mono text-[10px] tracking-[0.2em] text-ink-faint">
              PASSIVE SWEEP · LOCALHOST SECTOR
            </p>
          </div>
        </Panel>

        <Panel title="Claude Mission Totals" delay={0.16}>
          <div className="grid grid-cols-2 gap-4 p-4">
            <div>
              <p className="panel-title">Missions</p>
              <p className="font-mono text-xl font-bold text-neon-cyan">
                <NumberTicker value={claudeStats.runs} />
              </p>
            </div>
            <div>
              <p className="panel-title">Spend</p>
              <p className="font-mono text-xl font-bold text-neon-amber">
                <NumberTicker value={claudeStats.totalCostUsd} decimals={3} prefix="$" />
              </p>
            </div>
            <div>
              <p className="panel-title">Tokens Out</p>
              <p className="font-mono text-xl font-bold text-neon-magenta">
                <NumberTicker value={claudeStats.outputTokens} />
              </p>
            </div>
            <div>
              <p className="panel-title">Turns</p>
              <p className="font-mono text-xl font-bold text-neon-lime">
                <NumberTicker value={claudeStats.turns} />
              </p>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
