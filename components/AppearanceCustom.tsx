"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Panel from "./ui/Panel";
import { useLook, readSavedLooks, writeSavedLooks } from "./useLook";
import { readAppearance, readThemeChoice, saveAppearance } from "./useAppearance";
import { NAV_GROUPS, NAV_ALWAYS } from "./Sidebar";
import { COLOR_KEYS, FONT_SUGGESTIONS, arrangeGroup, arrangeGroups, cleanLook, type ColorKey, type CustomLook, type LookBackground, type LookMenu, type SavedLook } from "@/lib/lookCustom";
import { sanitizeAppearance, type ThemeChoice } from "@/lib/appearance";
import { FLEET_FOLLOW_KEY, checkFleetLook, followsFleet, markApplied } from "./FleetLookSync";

/**
 * Appearance → the custom layer (lib/lookCustom.ts): any colour, installed font, exact sizes, background,
 * the menu's order / names / visibility, and saved looks. Everything applies live and is saved in this
 * browser; Export / Import carry a look to another machine.
 */

const CSS_VAR: Record<ColorKey, string> = {
  cyan: "--ac-cyan", magenta: "--ac-magenta", amber: "--ac-amber", lime: "--ac-lime", violet: "--ac-violet", rose: "--ac-rose",
  void: "--surface-void", abyss: "--surface-abyss", panel: "--surface-panel", panel2: "--surface-panel-2", ink: "--tone-ink", inkDim: "--tone-ink-dim", inkFaint: "--tone-ink-faint", line: "--tone-line-bright",
};

/** The colour the page is using now, as #rrggbb (for the colour pickers' starting point). */
function currentHex(v: string): string {
  const s = v.trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`.toLowerCase();
  const m = /rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/i.exec(s);
  if (m) return `#${[m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, "0")).join("")}`;
  return "#888888";
}

const field = "rounded-md border border-line bg-transparent px-2 py-1 text-[12px] text-ink outline-none";
const btn = "cursor-pointer rounded-md border border-line px-2.5 py-1 font-mono text-[10px] text-ink-dim transition-colors hover:bg-white/[0.06] disabled:opacity-40";

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 border-b border-line py-3 last:border-b-0 sm:flex-row sm:items-center sm:gap-4">
      <div className="sm:w-52 sm:shrink-0">
        <p className="text-[13px] font-semibold text-ink">{label}</p>
        {hint && <p className="text-[11px] leading-4 text-ink-faint">{hint}</p>}
      </div>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

function Slider({ value, min, max, step = 1, unit, onChange, onClear, label }: { value?: number; min: number; max: number; step?: number; unit: string; onChange: (n: number) => void; onClear: () => void; label: string }) {
  return (
    <>
      <input type="range" min={min} max={max} step={step} value={value ?? min} aria-label={label} onChange={(e) => onChange(Number(e.target.value))} className="w-56" style={{ accentColor: "var(--page-accent)" }} />
      <span className="w-14 font-mono text-[11px] text-ink">{value === undefined ? "preset" : `${value}${unit}`}</span>
      {value !== undefined && (
        <button type="button" className={btn} onClick={onClear}>
          use preset
        </button>
      )}
    </>
  );
}

export default function AppearanceCustom() {
  const { look, setLook } = useLook();
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const say = (text: string, bad?: boolean) => setMsg({ text, bad });
  const [colorTheme, setColorTheme] = useState<"dark" | "light">("dark");
  const [tick, setTick] = useState(0); // re-read the page's current colours after a change
  useEffect(() => {
    setColorTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");
  }, []);
  const patch = (p: Partial<CustomLook>) => {
    const ok = setLook((cur) => ({ ...cur, ...p }));
    if (!ok) say("This browser couldn't store that (a background picture may be too big): try a smaller picture.", true);
    setTick((t) => t + 1);
  };

  // ── colours ──
  const live = useMemo(() => {
    void tick;
    if (typeof window === "undefined") return {} as Record<ColorKey, string>;
    const shown = document.documentElement.dataset.theme === "light" ? "light" : "dark";
    const cs = getComputedStyle(document.documentElement);
    const out = {} as Record<ColorKey, string>;
    for (const { key } of COLOR_KEYS) out[key] = shown === colorTheme ? currentHex(cs.getPropertyValue(CSS_VAR[key])) : look.colors?.[colorTheme]?.[key] ?? "#888888";
    return out;
  }, [tick, colorTheme, look]);
  const setColor = (key: ColorKey, v: string | null) => {
    const cur = { ...(look.colors?.[colorTheme] ?? {}) };
    if (v) cur[key] = v;
    else delete cur[key];
    patch({ colors: { ...(look.colors ?? {}), [colorTheme]: cur } });
  };

  // ── background ──
  const bg: LookBackground = look.background ?? { kind: "default" };
  const setBg = (p: Partial<LookBackground>) => patch({ background: { ...bg, ...p } });
  const fileRef = useRef<HTMLInputElement>(null);
  const pickImage = async (f: File | undefined) => {
    if (!f) return;
    if (!/^image\/(png|jpeg|webp|gif)$/.test(f.type)) return say("Choose a PNG, JPEG, WebP or GIF picture.", true);
    try {
      const bmp = await createImageBitmap(f);
      const scale = Math.min(1, 2560 / Math.max(bmp.width, bmp.height));
      const c = document.createElement("canvas");
      c.width = Math.round(bmp.width * scale);
      c.height = Math.round(bmp.height * scale);
      c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
      let url = c.toDataURL("image/jpeg", 0.85);
      if (url.length > 3_500_000) url = c.toDataURL("image/jpeg", 0.6);
      if (url.length > 3_500_000) return say("That picture is too big even after shrinking: try a smaller one.", true);
      setBg({ kind: "image", image: url, fit: bg.fit ?? "cover", dim: bg.dim ?? 35 });
      say(`Background picture set (${Math.round(url.length / 1024)} KB, kept in this browser).`);
    } catch (e) {
      say(`Couldn't read that picture: ${(e as Error).message}`, true);
    }
  };

  // ── menu ──
  const menu: LookMenu = look.menu ?? {};
  const setMenu = (p: Partial<LookMenu>) => patch({ menu: { ...menu, ...p } });
  const moveItem = (gid: string, href: string, dir: -1 | 1) => {
    const g = NAV_GROUPS.find((x) => x.id === gid)!;
    const list = arrangeGroup(gid, g.items, menu, true).map((x) => x.href);
    const i = list.indexOf(href), j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    setMenu({ order: { ...(menu.order ?? {}), [gid]: list } });
  };
  const moveGroup = (gid: string, dir: -1 | 1) => {
    const list = arrangeGroups(NAV_GROUPS.map((g) => g.id), menu);
    const i = list.indexOf(gid), j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    setMenu({ groupOrder: list });
  };
  const toggleHidden = (href: string, show: boolean) => {
    const h = new Set(menu.hidden ?? []);
    if (show) h.delete(href);
    else h.add(href);
    setMenu({ hidden: [...h] });
  };
  const rename = (href: string, v: string) => {
    const l = { ...(menu.labels ?? {}) };
    if (v.trim()) l[href] = v.trim().slice(0, 40);
    else delete l[href];
    setMenu({ labels: l });
  };
  const renameGroup = (gid: string, v: string) => {
    const l = { ...(menu.groupLabels ?? {}) };
    if (v.trim()) l[gid] = v.trim().slice(0, 40);
    else delete l[gid];
    setMenu({ groupLabels: l });
  };

  // ── saved looks ──
  const [saved, setSaved] = useState<SavedLook[]>([]);
  const [name, setName] = useState("");
  useEffect(() => setSaved(readSavedLooks()), []);
  const snapshot = (n: string): SavedLook => ({ name: n, at: Date.now(), appearance: readAppearance(), theme: readThemeChoice(), custom: cleanLook(look) });
  const applySnapshot = (s: SavedLook) => {
    saveAppearance(sanitizeAppearance(s.appearance), (["dark", "light", "system"].includes(String(s.theme)) ? s.theme : undefined) as ThemeChoice | undefined);
    setLook(cleanLook(s.custom));
    setTick((t) => t + 1);
  };
  const saveCurrent = () => {
    const n = name.trim().slice(0, 40);
    if (!n) return say("Give the look a name first.", true);
    const list = [snapshot(n), ...saved.filter((s) => s.name !== n)];
    if (!writeSavedLooks(list)) return say("This browser couldn't store another look (a background picture takes a lot of room).", true);
    setSaved(list);
    setName("");
    say(`Saved “${n}”.`);
  };
  const exportLook = () => {
    const blob = new Blob([JSON.stringify({ missionControlLook: 1, ...snapshot(name.trim() || "My look") }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `mission-control-look-${(name.trim() || "my-look").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const importRef = useRef<HTMLInputElement>(null);
  const importLook = async (f: File | undefined) => {
    if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      if (!j || typeof j !== "object" || !j.custom) throw new Error("not a Mission Control look file");
      applySnapshot({ name: String(j.name || "Imported"), at: Date.now(), appearance: j.appearance ?? {}, theme: j.theme, custom: j.custom });
      say(`Applied “${String(j.name || "the imported look").slice(0, 40)}”. Save it to keep it in the list.`);
    } catch (e) {
      say(`Couldn't use that file: ${(e as Error).message}`, true);
    }
  };
  const resetAll = () => {
    setLook({ v: 1 });
    setTick((t) => t + 1);
    say("Custom look cleared: the presets above apply again.");
  };

  const customCount = (look.colors?.dark ? Object.keys(look.colors.dark).length : 0) + (look.colors?.light ? Object.keys(look.colors.light).length : 0) + ["fontUi", "fontHeading", "fontMono", "zoom", "radius", "panelOpacity", "sidebarWidth"].filter((k) => (look as any)[k] !== undefined).length + (look.background && look.background.kind !== "default" ? 1 : 0) + (look.menu ? 1 : 0);

  return (
    <div className="flex flex-col gap-4">
      <Panel
        title="Customize everything"
        right={
          <button type="button" className={btn} onClick={resetAll} disabled={!customCount}>
            Clear custom look{customCount ? ` · ${customCount}` : ""}
          </button>
        }
      >
        <div className="flex flex-col gap-1 p-4">
          <p className="text-[11px] leading-4 text-ink-faint">Goes beyond the presets: these settings win over them. Everything applies at once and is saved in this browser; Saved looks below keep several and carry them to other machines.</p>
          {msg && (
            <p className="text-[11px]" style={{ color: msg.bad ? "var(--ac-rose)" : "var(--ac-lime)" }}>
              {msg.text}
            </p>
          )}
        </div>
      </Panel>

      <Panel title="Colors" right={<span className="flex gap-1">{(["dark", "light"] as const).map((t) => <button key={t} type="button" className={btn} aria-pressed={colorTheme === t} style={colorTheme === t ? { borderColor: "var(--page-accent)", color: "var(--color-ink)" } : undefined} onClick={() => setColorTheme(t)}>{t} theme</button>)}</span>}>
        <div className="flex flex-col p-4">
          <p className="pb-2 text-[11px] text-ink-faint">Editing the {colorTheme} theme’s colors{(typeof document !== "undefined" && (document.documentElement.dataset.theme === "light" ? "light" : "dark")) !== colorTheme ? " (switch to it to see them live)" : ""}. A color you haven’t changed follows the preset.</p>
          {(["Accents", "Surfaces", "Text"] as const).map((g) => (
            <Row key={g} label={g} hint={g === "Accents" ? "Page colors, agents and status (lime = OK, rose = errors)." : g === "Surfaces" ? "Behind and inside panels." : "Main, secondary and faint text."}>
              {COLOR_KEYS.filter((c) => c.group === g).map((c) => {
                const set = look.colors?.[colorTheme]?.[c.key];
                return (
                  <label key={c.key} className="flex items-center gap-1.5 rounded-lg border border-line px-2 py-1 text-[11px] text-ink" title={c.label}>
                    <input type="color" value={set ?? live[c.key] ?? "#888888"} onChange={(e) => setColor(c.key, e.target.value)} aria-label={`${c.label} (${colorTheme})`} className="h-6 w-7 cursor-pointer border-0 bg-transparent p-0" />
                    <span>{c.label}</span>
                    {set && (
                      <button type="button" className="cursor-pointer font-mono text-[10px] text-ink-faint underline" onClick={() => setColor(c.key, null)} aria-label={`Reset ${c.label}`}>
                        reset
                      </button>
                    )}
                  </label>
                );
              })}
            </Row>
          ))}
        </div>
      </Panel>

      <Panel title="Fonts and sizes">
        <div className="flex flex-col p-4">
          <datalist id="mc-font-list">
            {FONT_SUGGESTIONS.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
          {(
            [
              ["fontUi", "Interface font", "Any font installed on this computer, by name (a few fallbacks, comma separated, work too)."],
              ["fontHeading", "Headings font", "Page and panel titles."],
              ["fontMono", "Code font", "Commands, ids and code."],
            ] as const
          ).map(([k, label, hint]) => (
            <Row key={k} label={label} hint={hint}>
              <input list="mc-font-list" defaultValue={look[k] ?? ""} key={look[k] ?? "-"} placeholder="preset font" aria-label={label} onBlur={(e) => e.target.value.trim() !== (look[k] ?? "") && patch({ [k]: e.target.value.trim() || undefined })} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} className={`${field} w-64`} />
              {look[k] && <span style={{ fontFamily: look[k] }} className="text-[13px] text-ink">The quick brown fox 0123</span>}
              {look[k] && (
                <button type="button" className={btn} onClick={() => patch({ [k]: undefined })}>
                  use preset
                </button>
              )}
            </Row>
          ))}
          <Row label="Size (zoom)" hint="Everything bigger or smaller, from 70% to 160%.">
            <Slider label="Zoom" value={look.zoom} min={70} max={160} step={5} unit="%" onChange={(n) => patch({ zoom: n })} onClear={() => patch({ zoom: undefined })} />
          </Row>
          <Row label="Corner roundness" hint="Panels, from square to very round.">
            <Slider label="Corner radius" value={look.radius} min={0} max={32} unit="px" onChange={(n) => patch({ radius: n })} onClear={() => patch({ radius: undefined })} />
          </Row>
          <Row label="Panel opacity" hint="How much of the background shows through panels.">
            <Slider label="Panel opacity" value={look.panelOpacity} min={20} max={100} step={5} unit="%" onChange={(n) => patch({ panelOpacity: n })} onClear={() => patch({ panelOpacity: undefined })} />
          </Row>
          <Row label="Menu width" hint="When the menu is on the left or right.">
            <Slider label="Menu width" value={look.sidebarWidth} min={180} max={360} step={10} unit="px" onChange={(n) => patch({ sidebarWidth: n })} onClear={() => patch({ sidebarWidth: undefined })} />
          </Row>
        </div>
      </Panel>

      <Panel title="Background">
        <div className="flex flex-col p-4">
          <Row label="Background" hint="Behind everything.">
            {(
              [
                ["default", "Preset"],
                ["none", "Plain"],
                ["color", "A color"],
                ["gradient", "A gradient"],
                ["image", "My picture"],
              ] as const
            ).map(([k, l]) => (
              <button key={k} type="button" className={btn} aria-pressed={bg.kind === k} style={bg.kind === k ? { borderColor: "var(--page-accent)", color: "var(--color-ink)" } : undefined} onClick={() => (k === "image" && !bg.image ? fileRef.current?.click() : setBg({ kind: k }))}>
                {l}
              </button>
            ))}
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => void pickImage(e.target.files?.[0])} />
          </Row>
          {bg.kind === "color" && (
            <Row label="Color">
              <input type="color" value={bg.color ?? "#0b1020"} onChange={(e) => setBg({ color: e.target.value })} aria-label="Background color" className="h-7 w-10 cursor-pointer border-0 bg-transparent p-0" />
            </Row>
          )}
          {bg.kind === "gradient" && (
            <Row label="Gradient">
              <input type="color" value={bg.from ?? "#0b1020"} onChange={(e) => setBg({ from: e.target.value, to: bg.to ?? "#1d2b4f" })} aria-label="Gradient start" className="h-7 w-10 cursor-pointer border-0 bg-transparent p-0" />
              <span className="text-ink-faint">→</span>
              <input type="color" value={bg.to ?? "#1d2b4f"} onChange={(e) => setBg({ to: e.target.value, from: bg.from ?? "#0b1020" })} aria-label="Gradient end" className="h-7 w-10 cursor-pointer border-0 bg-transparent p-0" />
              <input type="range" min={0} max={360} step={5} value={bg.angle ?? 160} onChange={(e) => setBg({ angle: Number(e.target.value) })} aria-label="Gradient angle" className="w-40" style={{ accentColor: "var(--page-accent)" }} />
              <span className="font-mono text-[11px] text-ink">{bg.angle ?? 160}°</span>
            </Row>
          )}
          {bg.kind === "image" && (
            <>
              <Row label="Picture" hint="Shrunk to 2560 px and kept in this browser.">
                <button type="button" className={btn} onClick={() => fileRef.current?.click()}>
                  {bg.image ? "Choose another…" : "Choose a picture…"}
                </button>
                {(["cover", "contain", "tile"] as const).map((f) => (
                  <button key={f} type="button" className={btn} aria-pressed={(bg.fit ?? "cover") === f} style={(bg.fit ?? "cover") === f ? { borderColor: "var(--page-accent)", color: "var(--color-ink)" } : undefined} onClick={() => setBg({ fit: f })}>
                    {f === "cover" ? "Fill" : f === "contain" ? "Fit" : "Tile"}
                  </button>
                ))}
              </Row>
              <Row label="Dim it" hint="Keeps text readable over a busy picture.">
                <input type="range" min={0} max={90} step={5} value={bg.dim ?? 0} onChange={(e) => setBg({ dim: Number(e.target.value) })} aria-label="Dim the picture" className="w-48" style={{ accentColor: "var(--page-accent)" }} />
                <span className="font-mono text-[11px] text-ink">{bg.dim ?? 0}%</span>
              </Row>
              <Row label="Blur it">
                <input type="range" min={0} max={30} value={bg.blur ?? 0} onChange={(e) => setBg({ blur: Number(e.target.value) })} aria-label="Blur the picture" className="w-48" style={{ accentColor: "var(--page-accent)" }} />
                <span className="font-mono text-[11px] text-ink">{bg.blur ?? 0}px</span>
              </Row>
            </>
          )}
        </div>
      </Panel>

      <Panel title="Menu" right={<button type="button" className={btn} onClick={() => patch({ menu: undefined })} disabled={!look.menu}>Reset menu</button>}>
        <div className="flex flex-col gap-3 p-4">
          <p className="text-[11px] text-ink-faint">Order, rename or hide anything. The menu’s position (left, right or top) and its size are under Layout above. Appearance always stays in the menu so you can come back here.</p>
          <div className="flex flex-wrap gap-4 font-mono text-[10px] text-ink-dim">
            <label className="flex cursor-pointer items-center gap-1">
              <input type="checkbox" checked={!!menu.hideSub} onChange={(e) => setMenu({ hideSub: e.target.checked || undefined })} /> hide the small line under each name
            </label>
            <label className="flex cursor-pointer items-center gap-1">
              <input type="checkbox" checked={!!menu.hideHost} onChange={(e) => setMenu({ hideHost: e.target.checked || undefined })} /> hide the Host box
            </label>
          </div>
          {arrangeGroups(NAV_GROUPS.map((g) => g.id), menu).map((gid, gi, all) => {
            const g = NAV_GROUPS.find((x) => x.id === gid)!;
            const list = arrangeGroup(gid, g.items, menu, true);
            return (
              <div key={gid} className="rounded-xl border border-line p-3">
                <div className="flex flex-wrap items-center gap-2 pb-2">
                  <input defaultValue={menu.groupLabels?.[gid] ?? ""} key={`g-${gid}-${menu.groupLabels?.[gid] ?? ""}`} placeholder={g.label} aria-label={`Name of the ${g.label} group`} onBlur={(e) => e.target.value.trim() !== (menu.groupLabels?.[gid] ?? "") && renameGroup(gid, e.target.value)} className={`${field} w-44 font-semibold`} />
                  <button type="button" className={btn} disabled={gi === 0} onClick={() => moveGroup(gid, -1)} aria-label={`Move ${g.label} up`}>
                    ↑ group
                  </button>
                  <button type="button" className={btn} disabled={gi === all.length - 1} onClick={() => moveGroup(gid, 1)} aria-label={`Move ${g.label} down`}>
                    ↓ group
                  </button>
                  {gid === "agents" && <span className="font-mono text-[9px] text-ink-faint">agents you add in Settings join the end of this group</span>}
                </div>
                <div className="flex flex-col">
                  {list.map((it, i) => {
                    const orig = g.items.find((x) => x.href === it.href)!;
                    const locked = NAV_ALWAYS.includes(it.href);
                    return (
                      <div key={it.href} className="flex flex-wrap items-center gap-2 border-t border-line py-1.5 first:border-t-0" style={{ opacity: it.hidden ? 0.5 : 1 }}>
                        <label className="flex cursor-pointer items-center gap-1 font-mono text-[10px] text-ink-dim" title={locked ? "Always shown" : undefined}>
                          <input type="checkbox" checked={!it.hidden || locked} disabled={locked} onChange={(e) => toggleHidden(it.href, e.target.checked)} aria-label={`Show ${orig.label}`} />
                        </label>
                        <input defaultValue={menu.labels?.[it.href] ?? ""} key={`l-${it.href}-${menu.labels?.[it.href] ?? ""}`} placeholder={orig.label} aria-label={`Name for ${orig.label}`} onBlur={(e) => e.target.value.trim() !== (menu.labels?.[it.href] ?? "") && rename(it.href, e.target.value)} className={`${field} w-40`} />
                        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-ink-faint">{orig.sub}</span>
                        <button type="button" className={btn} disabled={i === 0} onClick={() => moveItem(gid, it.href, -1)} aria-label={`Move ${orig.label} up`}>
                          ↑
                        </button>
                        <button type="button" className={btn} disabled={i === list.length - 1} onClick={() => moveItem(gid, it.href, 1)} aria-label={`Move ${orig.label} down`}>
                          ↓
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel title="Saved looks">
        <div className="flex flex-col gap-3 p-4">
          <p className="text-[11px] text-ink-faint">A saved look keeps everything on this page: presets, theme and the custom settings. Export one as a file and Import it on another machine to make them match.</p>
          <div className="flex flex-wrap items-center gap-2">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name this look" aria-label="Look name" className={`${field} w-56`} onKeyDown={(e) => e.key === "Enter" && saveCurrent()} />
            <button type="button" className={btn} onClick={saveCurrent}>
              Save
            </button>
            <button type="button" className={btn} onClick={exportLook}>
              Export file
            </button>
            <button type="button" className={btn} onClick={() => importRef.current?.click()}>
              Import file…
            </button>
            <input ref={importRef} type="file" accept="application/json,.json" hidden onChange={(e) => void importLook(e.target.files?.[0])} />
          </div>
          {saved.length > 0 && (
            <div className="flex flex-col">
              {saved.map((s) => (
                <div key={s.name} className="flex items-center gap-2 border-t border-line py-1.5 first:border-t-0">
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{s.name}</span>
                  <span className="font-mono text-[10px] text-ink-faint">{new Date(s.at).toLocaleDateString()}</span>
                  <button type="button" className={btn} onClick={() => { applySnapshot(s); say(`Applied “${s.name}”.`); }}>
                    Apply
                  </button>
                  <button type="button" className={btn} onClick={() => { const list = saved.filter((x) => x.name !== s.name); writeSavedLooks(list); setSaved(list); }} aria-label={`Delete ${s.name}`}>
                    Delete
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </Panel>

      <FleetLookPanel snapshot={() => snapshot("fleet")} say={say} />
    </div>
  );
}

/** Push the look to every machine (lib/fleetLook.ts); each browser applies it once unless it keeps its own. */
function FleetLookPanel({ snapshot, say }: { snapshot: () => { appearance: Record<string, string>; theme?: string; custom: CustomLook }; say: (t: string, bad?: boolean) => void }) {
  const [meta, setMeta] = useState<{ version: number; at: number; by: string; name?: string } | null>(null);
  const [follow, setFollow] = useState(true);
  const [confirm, setConfirm] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => fetch("/api/look?meta=1", { cache: "no-store" }).then((r) => r.json()).then((j) => setMeta(j.look ?? null)).catch(() => {});
  useEffect(() => {
    load();
    setFollow(followsFleet());
  }, []);
  const push = async () => {
    setBusy(true);
    try {
      const s = snapshot();
      const r = await (await fetch("/api/look", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "push", ...s, name: name.trim() || undefined }) })).json();
      if (r.error) throw new Error(r.error);
      markApplied(r.version);
      say("Pushed to the whole Fleet. Each machine applies it within a few minutes (OneDrive), the next time Mission Control is open there; machines on an older version apply it after their update.");
      setConfirm(false);
      load();
    } catch (e) {
      say(`Couldn't push it: ${(e as Error).message}`, true);
    } finally {
      setBusy(false);
    }
  };
  const stop = async () => {
    await fetch("/api/look", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "clear" }) });
    say("Stopped sharing. Every machine keeps the look it has.");
    load();
  };
  const setFollowing = async (on: boolean) => {
    try {
      localStorage.setItem(FLEET_FOLLOW_KEY, on ? "on" : "off");
    } catch {
      /* private mode */
    }
    setFollow(on);
    if (on && (await checkFleetLook(true))) say("This browser now has the fleet look.");
  };
  return (
    <Panel title="The whole Fleet">
      <div className="flex flex-col gap-3 p-4">
        <p className="text-[11px] text-ink-faint">Push this browser’s whole look (presets, theme and the custom settings above, picture included) to every machine. Each one applies it once; after that it can be changed there again until the next push. A machine’s browser can choose to keep its own look.</p>
        <p className="font-mono text-[10px] text-ink-dim">{meta ? `Fleet look${meta.name ? ` “${meta.name}”` : ""}: pushed by ${meta.by} on ${new Date(meta.at).toLocaleString()}` : "No look is being shared with the Fleet."}</p>
        <div className="flex flex-wrap items-center gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (optional)" aria-label="Fleet look name" className={`${field} w-48`} />
          {!confirm ? (
            <button type="button" className={btn} onClick={() => setConfirm(true)} disabled={busy}>
              Push this look to the whole Fleet…
            </button>
          ) : (
            <>
              <span className="text-[11px]" style={{ color: "var(--ac-amber)" }}>Every machine’s Mission Control will switch to this look.</span>
              <button type="button" className={btn} style={{ borderColor: "var(--ac-amber)", color: "var(--color-ink)" }} onClick={() => void push()} disabled={busy}>
                {busy ? "Pushing…" : "Yes, push it"}
              </button>
              <button type="button" className={btn} onClick={() => setConfirm(false)}>
                Cancel
              </button>
            </>
          )}
          {meta && (
            <button type="button" className={btn} onClick={() => void stop()}>
              Stop sharing
            </button>
          )}
        </div>
        <label className="flex cursor-pointer items-center gap-1.5 font-mono text-[10px] text-ink-dim">
          <input type="checkbox" checked={follow} onChange={(e) => void setFollowing(e.target.checked)} /> this browser takes looks pushed to the Fleet (untick to keep its own)
        </label>
      </div>
    </Panel>
  );
}
