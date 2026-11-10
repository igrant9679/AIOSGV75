/**
 * Appearance settings — the look-and-feel layer. Every option is applied as a
 * data-* attribute on <html>; globals.css keys its rules off those attributes,
 * so changing a setting restyles the whole deck instantly with no re-render.
 *
 * Saved per browser in localStorage ("mc-appearance"), like the theme toggle
 * ("mc-theme"). A pre-paint boot script (appearanceBootScript, injected by
 * app/layout.tsx) applies them before first paint so there's no flash.
 *
 * Shared by the server layout (boot script) and the client — keep it free of
 * React and browser globals at module level.
 */

export type ThemeChoice = "dark" | "light" | "system";

export interface AppearanceOption {
  key: AppearanceKey;
  /** html data-attribute name (data-<attr>) */
  attr: string;
  group: "Look" | "Type" | "Layout" | "Behavior";
  label: string;
  hint: string;
  choices: { value: string; label: string }[];
}

export type AppearanceKey =
  | "palette"
  | "surface"
  | "contrast"
  | "panels"
  | "stripe"
  | "corners"
  | "bg"
  | "glow"
  | "font"
  | "mono"
  | "labels"
  | "scale"
  | "density"
  | "sidebar"
  | "sidebarSide"
  | "width"
  | "footer"
  | "motion"
  | "startPage";

export type Appearance = Record<AppearanceKey, string>;

export const APPEARANCE_OPTIONS: AppearanceOption[] = [
  // ── Look ──
  {
    key: "palette",
    attr: "palette",
    group: "Look",
    label: "Color palette",
    hint: "The six accent colors used for pages, agents and status.",
    choices: [
      { value: "mission", label: "MissionCommand" },
      { value: "neon", label: "Neon" },
      { value: "ocean", label: "Ocean" },
      { value: "sunset", label: "Sunset" },
      { value: "forest", label: "Forest" },
      { value: "pastel", label: "Pastel" },
      { value: "terminal", label: "Terminal" },
      { value: "mono", label: "Monochrome" },
    ],
  },
  {
    key: "surface",
    attr: "surface",
    group: "Look",
    label: "Background tone",
    hint: "The base color behind and inside panels.",
    choices: [
      { value: "mission", label: "MissionCommand (teal)" },
      { value: "cool", label: "Cool blue" },
      { value: "neutral", label: "Neutral gray" },
      { value: "warm", label: "Warm" },
      { value: "max", label: "Pure black / white" },
    ],
  },
  {
    key: "contrast",
    attr: "contrast",
    group: "Look",
    label: "Text contrast",
    hint: "High makes secondary text and borders easier to read.",
    choices: [
      { value: "standard", label: "Standard" },
      { value: "high", label: "High" },
    ],
  },
  {
    key: "panels",
    attr: "panels",
    group: "Look",
    label: "Panel style",
    hint: "How cards and sections are drawn.",
    choices: [
      { value: "glass", label: "Glass" },
      { value: "solid", label: "Solid" },
      { value: "outline", label: "Outline" },
      { value: "flat", label: "Flat" },
    ],
  },
  {
    key: "stripe",
    attr: "stripe",
    group: "Look",
    label: "Panel accent stripe",
    hint: "The colored line along the top of every panel.",
    choices: [
      { value: "on", label: "Show" },
      { value: "off", label: "Hide" },
    ],
  },
  {
    key: "corners",
    attr: "corners",
    group: "Look",
    label: "Corners",
    hint: "Roundness of panels, buttons and cards.",
    choices: [
      { value: "sharp", label: "Sharp" },
      { value: "soft", label: "Soft" },
      { value: "round", label: "Rounded" },
      { value: "extra", label: "Extra round" },
    ],
  },
  {
    key: "bg",
    attr: "bg",
    group: "Look",
    label: "Background effects",
    hint: "The colored glow, grid and page tint behind everything.",
    choices: [
      { value: "full", label: "Full" },
      { value: "subtle", label: "Subtle" },
      { value: "plain", label: "Plain" },
    ],
  },
  {
    key: "glow",
    attr: "glow",
    group: "Look",
    label: "Glow and shimmer",
    hint: "Hover glows, glowing text, the shimmering logo and the title scan line.",
    choices: [
      { value: "on", label: "On" },
      { value: "off", label: "Off" },
    ],
  },
  // ── Type ──
  {
    key: "font",
    attr: "font",
    group: "Type",
    label: "Interface font",
    hint: "Used for headings, labels and body text.",
    choices: [
      { value: "jakarta", label: "Plus Jakarta Sans" },
      { value: "grotesk", label: "Space Grotesk" },
      { value: "inter", label: "Inter" },
      { value: "plex", label: "IBM Plex Sans" },
      { value: "readable", label: "Atkinson Hyperlegible" },
      { value: "serif", label: "Source Serif" },
      { value: "system", label: "System (Segoe UI)" },
      { value: "monoui", label: "Monospace everywhere" },
    ],
  },
  {
    key: "mono",
    attr: "mono",
    group: "Type",
    label: "Code and data font",
    hint: "Used for numbers, timestamps, labels and code.",
    choices: [
      { value: "jakarta", label: "Same as interface (code stays monospace)" },
      { value: "jetbrains", label: "JetBrains Mono" },
      { value: "plexmono", label: "IBM Plex Mono" },
      { value: "fira", label: "Fira Code" },
      { value: "system", label: "Cascadia / Consolas" },
    ],
  },
  {
    key: "labels",
    attr: "labels",
    group: "Type",
    label: "Label style",
    hint: "Section and page titles in spaced capitals, or normal case.",
    choices: [
      { value: "caps", label: "SPACED CAPS" },
      { value: "normal", label: "Normal case" },
    ],
  },
  {
    key: "scale",
    attr: "scale",
    group: "Type",
    label: "Interface size",
    hint: "Scales text and controls together.",
    choices: [
      { value: "90", label: "90%" },
      { value: "100", label: "100%" },
      { value: "110", label: "110%" },
      { value: "125", label: "125%" },
    ],
  },
  // ── Layout ──
  {
    key: "density",
    attr: "density",
    group: "Layout",
    label: "Density",
    hint: "Spacing inside and between panels.",
    choices: [
      { value: "compact", label: "Compact" },
      { value: "comfortable", label: "Comfortable" },
      { value: "spacious", label: "Spacious" },
    ],
  },
  {
    key: "sidebar",
    attr: "sidebar",
    group: "Layout",
    label: "Sidebar",
    hint: "Full shows subtitles; icons-only gives the page more room.",
    choices: [
      { value: "full", label: "Full" },
      { value: "compact", label: "Compact" },
      { value: "icons", label: "Icons only" },
    ],
  },
  {
    key: "sidebarSide",
    attr: "sidebar-side",
    group: "Layout",
    label: "Sidebar position",
    hint: "Which side the navigation sits on.",
    choices: [
      { value: "left", label: "Left" },
      { value: "right", label: "Right" },
    ],
  },
  {
    key: "width",
    attr: "width",
    group: "Layout",
    label: "Content width",
    hint: "Maximum width of the deck on large screens.",
    choices: [
      { value: "focused", label: "Focused" },
      { value: "standard", label: "Standard" },
      { value: "wide", label: "Full width" },
    ],
  },
  {
    key: "footer",
    attr: "footer",
    group: "Layout",
    label: "Footer ticker",
    hint: "The live event line at the bottom of every page.",
    choices: [
      { value: "show", label: "Show" },
      { value: "hide", label: "Hide" },
    ],
  },
  // ── Behavior ──
  {
    key: "motion",
    attr: "motion",
    group: "Behavior",
    label: "Animation",
    hint: "Reduced keeps fades but stops looping effects; None turns animation off.",
    choices: [
      { value: "full", label: "Full" },
      { value: "reduced", label: "Reduced" },
      { value: "none", label: "None" },
    ],
  },
  {
    key: "startPage",
    attr: "start-page",
    group: "Behavior",
    label: "Start page",
    hint: "What opens first when you load the app.",
    choices: [
      { value: "/", label: "Overview" },
      { value: "/command", label: "Command" },
      { value: "/timeline", label: "Timeline" },
      { value: "/projects", label: "Projects" },
      { value: "/board", label: "Board" },
    ],
  },
];

export const APPEARANCE_DEFAULTS: Appearance = {
  palette: "mission",
  surface: "mission",
  contrast: "standard",
  panels: "glass",
  stripe: "on",
  corners: "round",
  bg: "full",
  glow: "on",
  font: "jakarta",
  mono: "jakarta",
  labels: "caps",
  scale: "100",
  density: "comfortable",
  sidebar: "full",
  sidebarSide: "left",
  width: "standard",
  footer: "show",
  motion: "full",
  startPage: "/",
};

export interface AppearancePreset {
  id: string;
  name: string;
  blurb: string;
  theme?: ThemeChoice;
  values: Partial<Appearance>;
}

/** One-click looks. Anything a preset doesn't name falls back to the default. */
export const APPEARANCE_PRESETS: AppearancePreset[] = [
  { id: "default", name: "MissionCommand", blurb: "Teal, maroon and gold on light grey, Plus Jakarta Sans (the default).", theme: "light", values: {} },
  {
    id: "neon",
    name: "Neon deck",
    blurb: "The original dark neon look with Space Grotesk.",
    theme: "dark",
    values: { palette: "neon", surface: "cool", font: "grotesk", mono: "jetbrains" },
  },
  {
    id: "calm",
    name: "Calm",
    blurb: "Ocean colors, solid panels, no glow, gentle motion.",
    values: { palette: "ocean", panels: "solid", bg: "subtle", glow: "off", motion: "reduced", labels: "normal", font: "inter" },
  },
  {
    id: "terminal",
    name: "Terminal",
    blurb: "Green-on-black, monospace, sharp outlines.",
    theme: "dark",
    values: { palette: "terminal", surface: "max", panels: "outline", corners: "sharp", bg: "plain", glow: "off", font: "monoui", mono: "jetbrains" },
  },
  {
    id: "paper",
    name: "Paper",
    blurb: "Light, warm and editorial with a serif face.",
    theme: "light",
    values: { palette: "forest", surface: "warm", panels: "flat", stripe: "off", bg: "plain", glow: "off", font: "serif", labels: "normal", motion: "reduced" },
  },
  {
    id: "focus",
    name: "Focus",
    blurb: "Icon sidebar, compact spacing, nothing moving.",
    values: { sidebar: "icons", density: "compact", width: "wide", bg: "subtle", glow: "off", motion: "reduced", footer: "hide", startPage: "/command" },
  },
  {
    id: "readable",
    name: "Easy reading",
    blurb: "Larger, high-contrast, extra-legible text.",
    values: { contrast: "high", font: "readable", scale: "110", labels: "normal", glow: "off", bg: "subtle", panels: "solid", density: "spacious" },
  },
];

export const APPEARANCE_STORAGE_KEY = "mc-appearance";
/** Bumped when the default look changes: browsers on an older version are moved to the new look once. */
export const LOOK_VERSION_KEY = "mc-look-version";
export const LOOK_VERSION = "2";
export const THEME_STORAGE_KEY = "mc-theme";
/** Fired on window whenever appearance or theme changes, so open components can resync. */
export const APPEARANCE_EVENT = "mc-appearance";

/** Keep only known keys with allowed values; fill the rest from defaults. */
export function sanitizeAppearance(raw: unknown): Appearance {
  const out: Appearance = { ...APPEARANCE_DEFAULTS };
  if (!raw || typeof raw !== "object") return out;
  for (const opt of APPEARANCE_OPTIONS) {
    const v = (raw as Record<string, unknown>)[opt.key];
    if (typeof v === "string" && opt.choices.some((c) => c.value === v)) out[opt.key] = v;
  }
  return out;
}

/**
 * Inline script for <head>/<body> start: applies the saved theme + appearance
 * attributes before first paint. Values are validated against the allow-list
 * so a hand-edited localStorage entry can't inject arbitrary attributes.
 */
export function appearanceBootScript(): string {
  const spec = APPEARANCE_OPTIONS.map((o) => [o.key, o.attr, o.choices.map((c) => c.value), APPEARANCE_DEFAULTS[o.key]]);
  return `try{if(localStorage.getItem("${LOOK_VERSION_KEY}")!=="${LOOK_VERSION}"){var o={};try{o=JSON.parse(localStorage.getItem("${APPEARANCE_STORAGE_KEY}")||"{}")||{}}catch(e){}o.palette="mission";o.surface="mission";o.font="jakarta";o.mono="jakarta";localStorage.setItem("${APPEARANCE_STORAGE_KEY}",JSON.stringify(o));localStorage.setItem("${THEME_STORAGE_KEY}","light");localStorage.setItem("${LOOK_VERSION_KEY}","${LOOK_VERSION}")}}catch(e){}try{var d=document.documentElement,t=localStorage.getItem("${THEME_STORAGE_KEY}")||"light";if(t==="system"){t=window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"}d.dataset.theme=t==="light"?"light":"dark";var a={};try{a=JSON.parse(localStorage.getItem("${APPEARANCE_STORAGE_KEY}")||"{}")||{}}catch(e){}var s=${JSON.stringify(spec)};for(var i=0;i<s.length;i++){var v=a[s[i][0]];d.setAttribute("data-"+s[i][1],s[i][2].indexOf(v)>=0?v:s[i][3])}}catch(e){}`;
}
