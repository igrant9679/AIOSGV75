export type Accent = "cyan" | "magenta" | "amber" | "lime" | "violet" | "rose";

/** Per-page accent — each route gets its own color identity (matches the sidebar). */
export const ROUTE_ACCENTS: Record<string, Accent> = {
  "/": "cyan",
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
  "/guide": "magenta",
};

export function accentForPath(pathname: string): Accent {
  return ROUTE_ACCENTS[pathname] ?? "cyan";
}

/** Page identity shown in the hero strip above every page's content. */
export const ROUTE_META: Record<string, { title: string; tagline: string }> = {
  "/": { title: "Overview", tagline: "Fleet & vitals" },
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
    soft: "rgba(34,211,238,0.15)",
    glow: "rgba(34,211,238,0.55)",
    border: "rgba(34,211,238,0.55)",
    gradFrom: "#0891b2",
    gradTo: "#67e8f9",
  },
  magenta: {
    base: "var(--ac-magenta)",
    soft: "rgba(232,121,249,0.15)",
    glow: "rgba(232,121,249,0.55)",
    border: "rgba(232,121,249,0.55)",
    gradFrom: "#a21caf",
    gradTo: "#f0abfc",
  },
  amber: {
    base: "var(--ac-amber)",
    soft: "rgba(251,191,36,0.15)",
    glow: "rgba(251,191,36,0.55)",
    border: "rgba(251,191,36,0.55)",
    gradFrom: "#d97706",
    gradTo: "#fde68a",
  },
  lime: {
    base: "var(--ac-lime)",
    soft: "rgba(163,230,53,0.15)",
    glow: "rgba(163,230,53,0.55)",
    border: "rgba(163,230,53,0.55)",
    gradFrom: "#65a30d",
    gradTo: "#d9f99d",
  },
  violet: {
    base: "var(--ac-violet)",
    soft: "rgba(167,139,250,0.15)",
    glow: "rgba(167,139,250,0.55)",
    border: "rgba(167,139,250,0.55)",
    gradFrom: "#7c3aed",
    gradTo: "#ddd6fe",
  },
  rose: {
    base: "var(--ac-rose)",
    soft: "rgba(251,113,133,0.15)",
    glow: "rgba(251,113,133,0.55)",
    border: "rgba(251,113,133,0.55)",
    gradFrom: "#e11d48",
    gradTo: "#fecdd3",
  },
};
