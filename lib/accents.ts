export type Accent = "cyan" | "magenta" | "amber" | "lime" | "violet" | "rose";

/** Per-page accent — each route gets its own color identity (matches the sidebar). */
export const ROUTE_ACCENTS: Record<string, Accent> = {
  "/": "cyan",
  "/command": "cyan",
  "/timeline": "violet",
  "/projects": "magenta",
  "/fleet": "lime",
  "/board": "amber",
  "/runs": "violet",
  "/github": "lime",
  "/work": "lime",
  "/auto": "cyan",
  "/claude": "violet",
  "/openclaw": "magenta",
  "/hermes": "amber",
  "/hermes-lab": "amber",
  "/mastermind": "cyan",
  "/jarvis": "cyan",
  "/pipeline": "violet",
  "/builds": "magenta",
  "/studio": "magenta",
  "/content": "violet",
  "/import": "cyan",
  "/conversations": "cyan",
  "/missions": "cyan",
  "/tasks": "amber",
  "/schedule": "lime",
  "/library": "violet",
  "/graph": "magenta",
  "/arena": "rose",
  "/analytics": "amber",
  "/reports": "lime",
  "/evals": "violet",
  "/goals": "lime",
  "/journal": "rose",
  "/memory": "violet",
  "/settings": "cyan",
  "/appearance": "magenta",
  "/guide": "magenta",
};

export function accentForPath(pathname: string): Accent {
  return ROUTE_ACCENTS[pathname] ?? "cyan";
}

/** Page identity shown in the hero strip above every page's content. */
export const ROUTE_META: Record<string, { title: string; tagline: string }> = {
  "/": { title: "Hub", tagline: "One box for everything" },
  "/overview": { title: "Overview", tagline: "Fleet & vitals" },
  "/city": { title: "Board", tagline: "Everything the fleet is doing or waiting on. Each agent sits in the room of the machine it runs on." },
  "/agents": { title: "Agents", tagline: "Your own agents: a name, a persona, a standing task, the tools it may use, and where it runs." },
  "/connections": { title: "Connections", tagline: "Every sign-in, key and service the fleet uses, in one place." },
  "/tools": { title: "Tools", tagline: "Your skills as short forms: fill it in, pick an engine, keep the result." },
  "/levelup": { title: "LevelUp", tagline: "Hand-offs from your planning app: approve, follow, review." },
  "/modules": { title: "Modules", tagline: "Switch whole pages on or off." },
  "/command": { title: "Command", tagline: "Second brain · what needs you" },
  "/timeline": { title: "Timeline", tagline: "Every AI action, one stream" },
  "/projects": { title: "Projects", tagline: "The brain, by project" },
  "/fleet": { title: "Fleet", tagline: "Machines × subscriptions" },
  "/board": { title: "Manager", tagline: "Manager · workers · reviewer" },
  "/runs": { title: "Runs", tagline: "Projects done by workers" },
  "/work": { title: "Work", tagline: "Every task your repositories mention · assign it to you or the fleet" },
  "/github": { title: "GitHub", tagline: "Every repository · what changed · what's waiting on you" },
  "/auto": { title: "Auto", tagline: "Smart router" },
  "/claude": { title: "Claude", tagline: "Primary operator · CLI bridge" },
  "/openclaw": { title: "OpenClaw", tagline: "Assistant gateway" },
  "/hermes": { title: "Hermes", tagline: "Nous research agent" },
  "/hermes-lab": { title: "Hermes Lab", tagline: "Goal mode · Control room" },
  "/mastermind": { title: "Mastermind", tagline: "All agents, one room" },
  "/jarvis": { title: "JARVIS", tagline: "Voice command center" },
  "/pipeline": { title: "Pipeline", tagline: "Inbox → Shipped" },
  "/builds": { title: "Builds", tagline: "Games & apps shelf" },
  "/studio": { title: "Studio", tagline: "Image · Voice · Video" },
  "/content": { title: "Content", tagline: "SEO drafts → publish" },
  "/import": { title: "Import", tagline: "Fold in AI chat history" },
  "/conversations": { title: "Conversations", tagline: "Search every chat" },
  "/missions": { title: "Missions", tagline: "Multi-agent operations" },
  "/tasks": { title: "Tasks", tagline: "Operator board" },
  "/schedule": { title: "Schedule", tagline: "Cron calendar" },
  "/library": { title: "Library", tagline: "Agent output docs" },
  "/graph": { title: "Graph", tagline: "Knowledge map" },
  "/arena": { title: "Arena", tagline: "Model battles" },
  "/analytics": { title: "Analytics", tagline: "Cost & usage ledger" },
  "/reports": { title: "Reports", tagline: "Exportable intelligence" },
  "/evals": { title: "Evals", tagline: "Model report cards" },
  "/goals": { title: "Goals", tagline: "Checkbox targets" },
  "/journal": { title: "Journal", tagline: "One file per day" },
  "/memory": { title: "Memory", tagline: "Shared by all agents" },
  "/settings": { title: "Settings", tagline: "LLMs · agents · spaces" },
  "/appearance": { title: "Appearance", tagline: "Look · type · layout" },
  "/guide": { title: "Guide", tagline: "Searchable manual" },
  "/watcher": { title: "Watcher", tagline: "Trend radar" },
};

export function metaForPath(pathname: string): { title: string; tagline: string } {
  const known = ROUTE_META[pathname];
  if (known) return known;
  const seg = pathname.split("/").filter(Boolean).pop() ?? "deck";
  return { title: seg.charAt(0).toUpperCase() + seg.slice(1), tagline: "Agent channel" };
}

/**
 * Accent palette. `base` resolves through CSS variables so both themes get
 * legible values (bright neon on dark, deeper tones on light) — use it in
 * `style={}` / CSS contexts, never string-concatenated with alpha suffixes
 * (use `border`, `soft`, or `glow` for translucent variants).
 */
export const ACCENTS: Record<
  Accent,
  { base: string; soft: string; glow: string; border: string; gradFrom: string; gradTo: string }
> = {
  cyan: {
    base: "var(--ac-cyan)",
    soft: "color-mix(in srgb, var(--nb-cyan) 15%, transparent)",
    glow: "color-mix(in srgb, var(--nb-cyan) 55%, transparent)",
    border: "color-mix(in srgb, var(--nb-cyan) 55%, transparent)",
    gradFrom: "#0891b2",
    gradTo: "#67e8f9",
  },
  magenta: {
    base: "var(--ac-magenta)",
    soft: "color-mix(in srgb, var(--nb-magenta) 15%, transparent)",
    glow: "color-mix(in srgb, var(--nb-magenta) 55%, transparent)",
    border: "color-mix(in srgb, var(--nb-magenta) 55%, transparent)",
    gradFrom: "#a21caf",
    gradTo: "#f0abfc",
  },
  amber: {
    base: "var(--ac-amber)",
    soft: "color-mix(in srgb, var(--nb-amber) 15%, transparent)",
    glow: "color-mix(in srgb, var(--nb-amber) 55%, transparent)",
    border: "color-mix(in srgb, var(--nb-amber) 55%, transparent)",
    gradFrom: "#d97706",
    gradTo: "#fde68a",
  },
  lime: {
    base: "var(--ac-lime)",
    soft: "color-mix(in srgb, var(--nb-lime) 15%, transparent)",
    glow: "color-mix(in srgb, var(--nb-lime) 55%, transparent)",
    border: "color-mix(in srgb, var(--nb-lime) 55%, transparent)",
    gradFrom: "#65a30d",
    gradTo: "#d9f99d",
  },
  violet: {
    base: "var(--ac-violet)",
    soft: "color-mix(in srgb, var(--nb-violet) 15%, transparent)",
    glow: "color-mix(in srgb, var(--nb-violet) 55%, transparent)",
    border: "color-mix(in srgb, var(--nb-violet) 55%, transparent)",
    gradFrom: "#7c3aed",
    gradTo: "#ddd6fe",
  },
  rose: {
    base: "var(--ac-rose)",
    soft: "color-mix(in srgb, var(--nb-rose) 15%, transparent)",
    glow: "color-mix(in srgb, var(--nb-rose) 55%, transparent)",
    border: "color-mix(in srgb, var(--nb-rose) 55%, transparent)",
    gradFrom: "#e11d48",
    gradTo: "#fecdd3",
  },
};
