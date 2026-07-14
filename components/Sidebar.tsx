"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { ACCENTS, type Accent } from "@/lib/accents";
import { useMission } from "./store";
import StatusOrb from "./ui/StatusOrb";
import Avatar, { type AvatarKind } from "./Avatar";
import { IconGrid, IconTarget, IconBook, IconBrain, IconGear, IconPlus, IconRocket, IconSwords, IconPulse, IconCheck, IconHelp, IconWrench, IconSpark, IconGraph, IconWing, IconTerminal } from "./icons";

interface NavItem {
  href: string;
  label: string;
  sub: string;
  accent: Accent;
  avatar?: AvatarKind;
  avatarName?: string;
  icon?: typeof IconGrid;
}

const AGENT_NAV: NavItem[] = [
  { href: "/", label: "Overview", sub: "Fleet & vitals", accent: "cyan", icon: IconGrid },
  { href: "/auto", label: "Auto", sub: "Smart router", accent: "cyan", avatarName: "Auto" },
  { href: "/claude", label: "Claude", sub: "Claude Code CLI", accent: "violet", avatar: "claude" },
  { href: "/openclaw", label: "OpenClaw", sub: "Assistant gateway", accent: "magenta", avatar: "openclaw" },
  { href: "/hermes", label: "Hermes", sub: "Nous agent", accent: "amber", avatar: "hermes" },
  { href: "/hermes-lab", label: "Hermes Lab", sub: "Goal Mode · Control Room", accent: "amber", icon: IconTarget },
];

const WORKSPACE_NAV: NavItem[] = [
  { href: "/mastermind", label: "Mastermind", sub: "All agents, one room", accent: "cyan", icon: IconWing },
  { href: "/builds", label: "Builds", sub: "Games & apps shelf", accent: "magenta", icon: IconTerminal },
  { href: "/missions", label: "Missions", sub: "Multi-agent tasks", accent: "cyan", icon: IconRocket },
  { href: "/tasks", label: "Tasks", sub: "Operator board", accent: "amber", icon: IconWrench },
  { href: "/schedule", label: "Schedule", sub: "Cron calendar", accent: "lime", icon: IconSpark },
  { href: "/library", label: "Library", sub: "Agent output docs", accent: "violet", icon: IconBook },
  { href: "/graph", label: "Graph", sub: "Knowledge map", accent: "magenta", icon: IconGraph },
  { href: "/arena", label: "Arena", sub: "Model battles", accent: "rose", icon: IconSwords },
  { href: "/analytics", label: "Analytics", sub: "Cost & usage", accent: "amber", icon: IconPulse },
  { href: "/evals", label: "Evals", sub: "Model report cards", accent: "violet", icon: IconCheck },
  { href: "/goals", label: "Goals", sub: "Checkbox targets", accent: "lime", icon: IconTarget },
  { href: "/journal", label: "Journal", sub: "One file per day", accent: "rose", icon: IconBook },
  { href: "/memory", label: "Memory", sub: "Shared by all agents", accent: "violet", icon: IconBrain },
  { href: "/settings", label: "Settings", sub: "LLMs · agents · spaces", accent: "cyan", icon: IconGear },
  { href: "/guide", label: "Guide", sub: "Searchable manual", accent: "magenta", icon: IconHelp },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { system, agents, busy, vaultOk, registry } = useMission();

  const dynamicNav: NavItem[] = [
    ...registry.llms.map((l) => ({
      href: `/agent/${l.id}`,
      label: l.name,
      sub: `${l.provider} · ${l.model}`.slice(0, 28),
      accent: l.accent,
      avatarName: l.name,
    })),
    ...registry.commandAgents.map((a) => ({
      href: `/agent/${a.id}`,
      label: a.name,
      sub: a.tagline.slice(0, 28),
      accent: a.accent,
      avatarName: a.name,
    })),
  ];

  const statusFor = (href: string): Accent => {
    if (href === "/claude") return system?.claudeVersion ? (busy.claude ? "amber" : "lime") : "rose";
    if (href === "/auto") return busy.auto ? "amber" : "lime";
    if (href === "/hermes-lab") { const h = agents.find((a) => a.id === "hermes"); return h?.available ? "lime" : "rose"; }
    if (href === "/watcher") return "lime";
    if (href === "/" || href === "/settings" || href === "/missions" || href === "/arena" || href === "/analytics" || href === "/evals" || href === "/guide" || href === "/tasks" || href === "/schedule" || href === "/mastermind") return "lime";
    if (href === "/goals" || href === "/journal" || href === "/memory" || href === "/library" || href === "/graph" || href === "/builds") return vaultOk ? "lime" : "rose";
    const id = href.replace("/agent/", "").replace("/", "");
    if (busy[id]) return "amber";
    const llm = registry.llms.find((l) => l.id === id);
    if (llm) return llm.hasKey ? "lime" : "rose";
    const agent = agents.find((a) => a.id === id);
    if (!agent) return "rose";
    return agent.available ? "lime" : "rose";
  };

  const renderItem = (item: NavItem) => {
    const active = pathname === item.href;
    const c = ACCENTS[item.accent];
    const Icon = item.icon;
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? "page" : undefined}
        className="relative flex min-h-12 items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-white/[0.04]"
        style={active ? { background: c.soft } : undefined}
      >
        {active && (
          <motion.span
            layoutId="nav-beam"
            className="absolute left-0 top-1/2 h-7 w-[3px] -translate-y-1/2 rounded-full"
            style={{ background: c.base, boxShadow: `0 0 12px ${c.glow}` }}
          />
        )}
        {item.avatar || item.avatarName ? (
          <Avatar kind={item.avatar} name={item.avatarName} accent={item.accent} size={30} />
        ) : (
          <span
            className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full"
            style={{ background: c.soft, color: c.base }}
          >
            {Icon && <Icon width={15} height={15} />}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span
            className="block truncate text-sm font-semibold tracking-wide"
            style={{ color: active ? c.base : "var(--color-ink)" }}
          >
            {item.label}
          </span>
          <span className="block truncate text-[10px] text-ink-faint">{item.sub}</span>
        </span>
        <StatusOrb accent={statusFor(item.href)} pulsing={statusFor(item.href) === "amber"} size={7} />
      </Link>
    );
  };

  return (
    <motion.nav
      initial={{ opacity: 0, x: -18 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="panel flex w-60 shrink-0 flex-col gap-1 p-3"
      aria-label="Agents"
    >
      <span className="panel-title px-2 pb-2 pt-1">Agents</span>
      {AGENT_NAV.map((item) => renderItem(item))}
      {dynamicNav.map((item) => renderItem(item))}
      <Link
        href="/settings"
        className="flex min-h-9 items-center gap-2 rounded-xl px-3 py-1.5 text-[11px] font-medium text-ink-faint transition-colors hover:bg-white/[0.04] hover:text-ink"
      >
        <IconPlus width={13} height={13} /> Add agent
      </Link>

      <span className="panel-title px-2 pb-2 pt-4">Workspace</span>
      {WORKSPACE_NAV.map((item) => renderItem(item))}

      <div className="mt-auto rounded-xl border border-line bg-white/[0.02] p-3">
        <p className="panel-title pb-1.5">Host</p>
        <p className="font-mono text-[11px] leading-5 text-ink-dim">
          {system?.hostname ?? "—"}
          <br />
          {system?.platform ?? "detecting…"}
        </p>
      </div>
    </motion.nav>
  );
}
