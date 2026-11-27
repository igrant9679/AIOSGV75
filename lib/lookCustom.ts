/**
 * Custom look: the free-form layer on top of the Appearance presets (lib/appearance.ts). The owner picks
 * any colour for every accent, surface and text tone (separately for dark and light), any font installed
 * on the computer, an exact zoom, corner radius and panel opacity, a background (colour, gradient or their
 * own picture), the menu's order / names / visibility and where the menu sits.
 *
 * Saved per browser in localStorage ("mc-look-custom"), like the presets. It is turned into CSS by
 * `buildLookCss`, which is SELF-CONTAINED (no imports, no outside helpers) because the pre-paint boot script
 * embeds its source (`lookBootScript`) to apply the look before first paint. Every value is validated there:
 * colours are #rrggbb only, font names a short list of safe characters, numbers clamped, a picture only a
 * base64 data: image — so a hand-edited localStorage entry can't inject CSS. Tested: scripts/test-look.mjs.
 */

export const LOOK_STORAGE_KEY = "mc-look-custom";
export const LOOKS_SAVED_KEY = "mc-looks-saved";
export const LOOK_EVENT = "mc-look-custom";

export type ColorKey = "cyan" | "magenta" | "amber" | "lime" | "violet" | "rose" | "void" | "abyss" | "panel" | "panel2" | "ink" | "inkDim" | "inkFaint" | "line";
export const COLOR_KEYS: { key: ColorKey; label: string; group: "Accents" | "Surfaces" | "Text" }[] = [
  { key: "cyan", label: "Accent 1 (cyan)", group: "Accents" },
  { key: "magenta", label: "Accent 2 (magenta)", group: "Accents" },
  { key: "amber", label: "Accent 3 (amber)", group: "Accents" },
  { key: "lime", label: "Accent 4 (lime / OK)", group: "Accents" },
  { key: "violet", label: "Accent 5 (violet)", group: "Accents" },
  { key: "rose", label: "Accent 6 (rose / errors)", group: "Accents" },
  { key: "void", label: "Page background", group: "Surfaces" },
  { key: "abyss", label: "Background, second tone", group: "Surfaces" },
  { key: "panel", label: "Panels", group: "Surfaces" },
  { key: "panel2", label: "Panels, inner", group: "Surfaces" },
  { key: "line", label: "Borders and lines", group: "Surfaces" },
  { key: "ink", label: "Text", group: "Text" },
  { key: "inkDim", label: "Secondary text", group: "Text" },
  { key: "inkFaint", label: "Faint text", group: "Text" },
];

export interface LookBackground {
  kind: "default" | "color" | "gradient" | "image" | "none";
  color?: string;
  from?: string;
  to?: string;
  angle?: number;
  /** a data:image/…;base64 picture, already shrunk by the page (≤ ~2.5 MB) */
  image?: string;
  fit?: "cover" | "contain" | "tile";
  /** 0–90: darken (dark theme) or lighten (light theme) the picture so text stays readable */
  dim?: number;
  blur?: number;
}
export interface LookMenu {
  /** group id → hrefs in the order to show (items not listed keep their place after these) */
  order?: Record<string, string[]>;
  hidden?: string[];
  labels?: Record<string, string>;
  groupOrder?: string[];
  groupLabels?: Record<string, string>;
  hideSub?: boolean;
  hideHost?: boolean;
}
export interface CustomLook {
  v: 1;
  colors?: { dark?: Partial<Record<ColorKey, string>>; light?: Partial<Record<ColorKey, string>> };
  fontUi?: string;
  fontHeading?: string;
  fontMono?: string;
  /** whole-interface zoom, 70–160 (%); unset = the preset size */
  zoom?: number;
  /** panel corner radius in px, 0–32 */
  radius?: number;
  /** panel opacity 20–100 (%) */
  panelOpacity?: number;
  /** sidebar width in px, 180–360 */
  sidebarWidth?: number;
  background?: LookBackground;
  menu?: LookMenu;
}
export interface SavedLook { name: string; at: number; appearance: Record<string, string>; theme?: string; custom: CustomLook }

export const EMPTY_LOOK: CustomLook = { v: 1 };

/** Installed-font suggestions for the font boxes (any installed font name works). */
export const FONT_SUGGESTIONS = ["Segoe UI", "Segoe UI Variable Text", "Calibri", "Arial", "Helvetica", "Verdana", "Tahoma", "Trebuchet MS", "Georgia", "Cambria", "Times New Roman", "Garamond", "Palatino Linotype", "Century Gothic", "Franklin Gothic Medium", "Gill Sans MT", "Aptos", "Bahnschrift", "Lucida Sans Unicode", "Consolas", "Cascadia Code", "Cascadia Mono", "Courier New", "Lucida Console", "SF Pro Text", "Menlo"];

/**
 * The CSS for a custom look. SELF-CONTAINED on purpose (see the file comment): everything it needs is
 * inside it. Returns "" for an empty look. Validates every value it uses.
 */
export function buildLookCss(look: unknown): string {
  var L: any = look && typeof look === "object" ? look : {};
  var hex = function (v: unknown): string | null { return typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : null; };
  var num = function (v: unknown, lo: number, hi: number): number | null { var n = Number(v); return typeof v === "number" && isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : null; };
  var fam = function (v: unknown): string | null {
    if (typeof v !== "string") return null;
    var parts = v.split(",").map(function (s) { return s.trim(); }).filter(function (s) { return s.length > 0; }).slice(0, 4);
    var ok = parts.filter(function (s) { return /^[A-Za-z0-9 _-]{1,60}$/.test(s); });
    return ok.length && ok.length === parts.length ? ok.map(function (s) { return '"' + s + '"'; }).join(", ") : null;
  };
  var out: string[] = [];
  var VARS: Record<string, string[]> = {
    cyan: ["--ac-cyan", "--nb-cyan"], magenta: ["--ac-magenta", "--nb-magenta"], amber: ["--ac-amber", "--nb-amber"], lime: ["--ac-lime", "--nb-lime"],
    violet: ["--ac-violet", "--nb-violet"], rose: ["--ac-rose", "--nb-rose"], void: ["--surface-void"], abyss: ["--surface-abyss"], panel: ["--surface-panel", "--panel-light-base"],
    panel2: ["--surface-panel-2"], ink: ["--tone-ink"], inkDim: ["--tone-ink-dim"], inkFaint: ["--tone-ink-faint"], line: ["--tone-line", "--tone-line-bright"],
  };
  var op = num(L.panelOpacity, 20, 100);
  var themes = ["dark", "light"];
  for (var ti = 0; ti < themes.length; ti++) {
    var th = themes[ti];
    var c: any = L.colors && typeof L.colors === "object" ? L.colors[th] : null;
    var decl: string[] = [];
    if (c && typeof c === "object") {
      for (var k in VARS) {
        var v = hex(c[k]);
        if (!v) continue;
        for (var j = 0; j < VARS[k].length; j++) decl.push(VARS[k][j] + ":" + (VARS[k][j] === "--tone-line" ? "color-mix(in srgb, " + v + " 55%, transparent)" : v) + " !important");
      }
    }
    var panel = c && typeof c === "object" ? hex(c.panel) : null;
    if (panel || op !== null) {
      var base = panel || (th === "dark" ? "#0c0f20" : "#ffffff");
      decl.push("--panel-bg:color-mix(in srgb, " + base + " " + (op === null ? (th === "dark" ? 66 : 92) : op) + "%, transparent) !important");
    }
    if (decl.length) out.push(':root[data-theme="' + th + '"]{' + decl.join(";") + "}");
  }
  var fu = fam(L.fontUi), fh = fam(L.fontHeading), fm = fam(L.fontMono);
  if (fu) out.push(":root{--mc-font-ui:" + fu + ", ui-sans-serif, system-ui, sans-serif !important}");
  if (fm) out.push(":root{--mc-font-code:" + fm + ", ui-monospace, monospace !important}");
  if (fh) out.push("h1,h2,h3,.panel-title,.page-hero-title{font-family:" + fh + ", var(--mc-font-ui) !important}");
  var z = num(L.zoom, 70, 160);
  if (z !== null) out.push(".deck-frame{zoom:" + z / 100 + " !important}");
  var r = num(L.radius, 0, 32);
  if (r !== null) out.push(":root{--panel-radius:" + r + "px !important}.panel{border-radius:" + r + "px !important}");
  var sw = num(L.sidebarWidth, 180, 360);
  if (sw !== null) out.push("@media (min-width: 768px){:root:not([data-sidebar=\"icons\"]):not([data-sidebar-side=\"top\"]) .mc-sidebar{width:" + sw + "px !important}}");
  var m: any = L.menu && typeof L.menu === "object" ? L.menu : {};
  if (m.hideSub === true) out.push(".mc-sidebar .sb-sub{display:none !important}");
  if (m.hideHost === true) out.push(".mc-sidebar .sb-host{display:none !important}");
  var b: any = L.background && typeof L.background === "object" ? L.background : null;
  if (b && b.kind && b.kind !== "default") {
    // the preset background goes only when the chosen one is valid (an invalid one changes nothing)
    var hide = ".ambient{display:none !important}";
    if (b.kind === "none") out.push(hide);
    else if (b.kind === "color" && hex(b.color)) out.push(hide, "body{background:" + hex(b.color) + " !important}");
    else if (b.kind === "gradient" && hex(b.from) && hex(b.to)) {
      var ang = num(b.angle, 0, 360);
      out.push(hide, "body{background:linear-gradient(" + (ang === null ? 160 : ang) + "deg, " + hex(b.from) + ", " + hex(b.to) + ") fixed !important}");
    } else if (b.kind === "image" && typeof b.image === "string" && b.image.length < 4000000 && /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/.test(b.image)) {
      out.push(hide);
      var dim = num(b.dim, 0, 90);
      var blur = num(b.blur, 0, 30);
      var fit = b.fit === "contain" ? "center/contain no-repeat" : b.fit === "tile" ? "top left/auto repeat" : "center/cover no-repeat";
      out.push('body::before{content:"";position:fixed;inset:' + (blur ? -2 * blur : 0) + "px;z-index:0;pointer-events:none;background:url(\"" + b.image + "\") " + fit + ";" + (blur ? "filter:blur(" + blur + "px);" : "") + "}");
      if (dim) {
        out.push('body::after{content:"";position:fixed;inset:0;z-index:0;pointer-events:none;background:rgba(5,6,15,' + dim / 100 + ")}");
        out.push(':root[data-theme="light"] body::after{background:rgba(255,255,255,' + dim / 100 + ")}");
      }
      out.push("body{background:var(--color-void) !important}");
    }
  }
  return out.join("\n");
}

/** Keep a look's shape sane (the page saves only what this returns). */
export function cleanLook(raw: unknown): CustomLook {
  const L: any = raw && typeof raw === "object" ? raw : {};
  const out: CustomLook = { v: 1 };
  const hex = (v: unknown) => (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : undefined);
  const colorSet = (c: any) => {
    if (!c || typeof c !== "object") return undefined;
    const o: Partial<Record<ColorKey, string>> = {};
    for (const { key } of COLOR_KEYS) { const v = hex(c[key]); if (v) o[key] = v; }
    return Object.keys(o).length ? o : undefined;
  };
  const dark = colorSet(L.colors?.dark), light = colorSet(L.colors?.light);
  if (dark || light) out.colors = { ...(dark ? { dark } : {}), ...(light ? { light } : {}) };
  for (const k of ["fontUi", "fontHeading", "fontMono"] as const) if (typeof L[k] === "string" && L[k].trim()) out[k] = L[k].trim().slice(0, 200);
  const n = (v: unknown, lo: number, hi: number) => (typeof v === "number" && isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : undefined);
  const z = n(L.zoom, 70, 160); if (z !== undefined) out.zoom = z;
  const r = n(L.radius, 0, 32); if (r !== undefined) out.radius = r;
  const po = n(L.panelOpacity, 20, 100); if (po !== undefined) out.panelOpacity = po;
  const sw = n(L.sidebarWidth, 180, 360); if (sw !== undefined) out.sidebarWidth = sw;
  const b = L.background;
  if (b && typeof b === "object" && ["color", "gradient", "image", "none"].includes(b.kind)) {
    out.background = { kind: b.kind, color: hex(b.color), from: hex(b.from), to: hex(b.to), angle: n(b.angle, 0, 360), fit: ["cover", "contain", "tile"].includes(b.fit) ? b.fit : undefined, dim: n(b.dim, 0, 90), blur: n(b.blur, 0, 30) };
    if (b.kind === "image" && typeof b.image === "string" && /^data:image\/(png|jpeg|webp|gif);base64,/.test(b.image) && b.image.length < 4_000_000) out.background.image = b.image;
  }
  const m = L.menu;
  if (m && typeof m === "object") {
    const strs = (a: unknown, max: number) => (Array.isArray(a) ? a.filter((x): x is string => typeof x === "string" && x.length < 120).slice(0, max) : undefined);
    const dict = (d: unknown) => {
      if (!d || typeof d !== "object") return undefined;
      const o: Record<string, string> = {};
      for (const [k, v] of Object.entries(d as Record<string, unknown>)) if (typeof v === "string" && v.trim() && k.length < 120) o[k] = v.trim().slice(0, 40);
      return Object.keys(o).length ? o : undefined;
    };
    const order: Record<string, string[]> = {};
    if (m.order && typeof m.order === "object") for (const [g, list] of Object.entries(m.order as Record<string, unknown>)) { const l = strs(list, 100); if (l?.length) order[g.slice(0, 40)] = l; }
    const menu: LookMenu = {
      ...(Object.keys(order).length ? { order } : {}),
      ...(strs(m.hidden, 200)?.length ? { hidden: strs(m.hidden, 200) } : {}),
      ...(dict(m.labels) ? { labels: dict(m.labels) } : {}),
      ...(strs(m.groupOrder, 10)?.length ? { groupOrder: strs(m.groupOrder, 10) } : {}),
      ...(dict(m.groupLabels) ? { groupLabels: dict(m.groupLabels) } : {}),
      ...(m.hideSub === true ? { hideSub: true } : {}),
      ...(m.hideHost === true ? { hideHost: true } : {}),
    };
    if (Object.keys(menu).length) out.menu = menu;
  }
  return out;
}

/** Items of one menu group in the owner's order, hidden ones out, renamed ones renamed. Pure. */
export function arrangeGroup<T extends { href: string; label: string }>(groupId: string, items: T[], menu?: LookMenu, keepHidden = false): (T & { hidden?: boolean })[] {
  const order = menu?.order?.[groupId] ?? [];
  const rank = (h: string) => { const i = order.indexOf(h); return i < 0 ? order.length + items.findIndex((x) => x.href === h) : i; };
  return [...items]
    .sort((a, b) => rank(a.href) - rank(b.href))
    .map((it) => ({ ...it, label: menu?.labels?.[it.href] || it.label, hidden: menu?.hidden?.includes(it.href) }))
    .filter((it) => keepHidden || !it.hidden);
}
/** Group ids in the owner's order. */
export function arrangeGroups(ids: string[], menu?: LookMenu): string[] {
  const order = (menu?.groupOrder ?? []).filter((g) => ids.includes(g));
  return [...order, ...ids.filter((g) => !order.includes(g))];
}

/** Pre-paint: apply the saved custom look (the generator's own source, embedded). */
export function lookBootScript(): string {
  return `try{var __l=JSON.parse(localStorage.getItem("${LOOK_STORAGE_KEY}")||"null");if(__l){var __c=(${buildLookCss.toString()})(__l);if(__c){var __s=document.createElement("style");__s.id="mc-look-custom";__s.textContent=__c;document.head.appendChild(__s)}}}catch(e){}`;
}
