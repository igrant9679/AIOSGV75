export type Accent = "cyan" | "magenta" | "amber" | "lime" | "violet" | "rose";

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
