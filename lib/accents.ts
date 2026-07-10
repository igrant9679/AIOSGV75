export type Accent = "cyan" | "magenta" | "amber" | "lime" | "violet" | "rose";

export const ACCENTS: Record<
  Accent,
  { base: string; soft: string; glow: string; gradFrom: string; gradTo: string }
> = {
  cyan: {
    base: "#22d3ee",
    soft: "rgba(34,211,238,0.15)",
    glow: "rgba(34,211,238,0.55)",
    gradFrom: "#0891b2",
    gradTo: "#67e8f9",
  },
  magenta: {
    base: "#e879f9",
    soft: "rgba(232,121,249,0.15)",
    glow: "rgba(232,121,249,0.55)",
    gradFrom: "#a21caf",
    gradTo: "#f0abfc",
  },
  amber: {
    base: "#fbbf24",
    soft: "rgba(251,191,36,0.15)",
    glow: "rgba(251,191,36,0.55)",
    gradFrom: "#d97706",
    gradTo: "#fde68a",
  },
  lime: {
    base: "#a3e635",
    soft: "rgba(163,230,53,0.15)",
    glow: "rgba(163,230,53,0.55)",
    gradFrom: "#65a30d",
    gradTo: "#d9f99d",
  },
  violet: {
    base: "#a78bfa",
    soft: "rgba(167,139,250,0.15)",
    glow: "rgba(167,139,250,0.55)",
    gradFrom: "#7c3aed",
    gradTo: "#ddd6fe",
  },
  rose: {
    base: "#fb7185",
    soft: "rgba(251,113,133,0.15)",
    glow: "rgba(251,113,133,0.55)",
    gradFrom: "#e11d48",
    gradTo: "#fecdd3",
  },
};
