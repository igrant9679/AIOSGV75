"use client";

import { useMemo } from "react";
import Panel from "./ui/Panel";
import GlowTile from "./ui/GlowTile";
import StatusOrb from "./ui/StatusOrb";
import { ACCENTS, type Accent } from "@/lib/accents";
import {
  APPEARANCE_DEFAULTS,
  APPEARANCE_OPTIONS,
  APPEARANCE_PRESETS,
  type Appearance,
  type AppearanceOption,
  type ThemeChoice,
} from "@/lib/appearance";
import { useAppearance } from "./useAppearance";

/** Swatches for the palette buttons and preset cards (the bright --nb-* set). */
const PALETTE_SWATCH: Record<string, string[]> = {
  neon: ["#22d3ee", "#e879f9", "#fbbf24", "#a3e635", "#a78bfa", "#fb7185"],
  ocean: ["#38bdf8", "#a5b4fc", "#fcd34d", "#5eead4", "#93c5fd", "#fda4af"],
  sunset: ["#fb923c", "#f472b6", "#fbbf24", "#bef264", "#f87171", "#fb7185"],
  forest: ["#34d399", "#c4b5fd", "#fcd34d", "#a3e635", "#4ade80", "#fca5a5"],
  pastel: ["#a5f3fc", "#f5d0fe", "#fde68a", "#d9f99d", "#ddd6fe", "#fecdd3"],
  terminal: ["#22c55e", "#4ade80", "#facc15", "#86efac", "#16a34a", "#f87171"],
  mono: ["#94a3b8", "#cbd5e1", "#fcd34d", "#86efac", "#e2e8f0", "#fda4af"],
};

/** CSS font stacks so font buttons render in their own face. */
const FONT_SAMPLE: Record<string, string> = {
  grotesk: "var(--font-space-grotesk)",
  inter: "var(--font-inter)",
  plex: "var(--font-plex-sans)",
  readable: "var(--font-atkinson)",
  serif: "var(--font-source-serif), Georgia, serif",
  system: '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif',
  monoui: "var(--mc-font-code)",
  jetbrains: "var(--font-jetbrains)",
  plexmono: "var(--font-plex-mono)",
  fira: "var(--font-fira-code)",
};

const THEME_CHOICES: { value: ThemeChoice; label: string }[] = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "system", label: "Match system" },
];

const GROUPS: AppearanceOption["group"][] = ["Look", "Type", "Layout", "Behavior"];

function Swatch({ colors }: { colors: string[] }) {
  return (
    <span className="inline-flex shrink-0 -space-x-1">
      {colors.slice(0, 6).map((c, i) => (
        <span key={i} className="h-3 w-3 rounded-full border border-black/20" style={{ background: c }} />
      ))}
    </span>
  );
}

function Segment({
  choices,
  value,
  onPick,
  render,
}: {
  choices: { value: string; label: string }[];
  value: string;
  onPick: (v: string) => void;
  render?: (c: { value: string; label: string }) => React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup">
      {choices.map((c) => {
        const on = c.value === value;
        return (
          <button
            key={c.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onPick(c.value)}
            className="flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors hover:bg-white/[0.06]"
            style={{
              borderColor: on ? "var(--page-accent)" : "var(--color-line)",
              color: on ? "var(--page-accent)" : "var(--color-ink-dim)",
              background: on ? "color-mix(in srgb, var(--page-accent) 12%, transparent)" : undefined,
            }}
          >
            {render ? render(c) : c.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Appearance — every look-and-feel setting in one place, applied live to the
 * whole deck. Saved in this browser only (like the light/dark toggle).
 */
export default function AppearanceSection() {
  const { appearance, theme, update } = useAppearance();

  const changed = useMemo(
    () => APPEARANCE_OPTIONS.filter((o) => appearance[o.key] !== APPEARANCE_DEFAULTS[o.key]).length + (theme !== "dark" ? 1 : 0),
    [appearance, theme],
  );

  const activePreset = useMemo(() => {
    return APPEARANCE_PRESETS.find((p) => {
      const want: Appearance = { ...APPEARANCE_DEFAULTS, ...p.values };
      const themeOk = !p.theme || p.theme === theme;
      return themeOk && APPEARANCE_OPTIONS.every((o) => want[o.key] === appearance[o.key]);
    })?.id;
  }, [appearance, theme]);

  const applyPreset = (id: string) => {
    const p = APPEARANCE_PRESETS.find((x) => x.id === id);
    if (!p) return;
    update({ ...APPEARANCE_DEFAULTS, ...p.values }, p.theme ?? (id === "default" ? "dark" : undefined));
  };

  const renderChoice = (o: AppearanceOption) => (c: { value: string; label: string }) => {
    if (o.key === "palette") {
      return (
        <>
          <Swatch colors={PALETTE_SWATCH[c.value] ?? []} />
          {c.label}
        </>
      );
    }
    if (o.key === "font" || o.key === "mono") {
      return <span style={{ fontFamily: FONT_SAMPLE[c.value] }}>{c.label}</span>;
    }
    return c.label;
  };

  return (
    <div className="flex flex-col gap-4">
      <Panel
        title="Presets"
        right={
          <button
            type="button"
            onClick={() => applyPreset("default")}
            className="cursor-pointer rounded-md border border-line px-2.5 py-1 font-mono text-[10px] text-ink-dim transition-colors hover:bg-white/[0.06]"
          >
            Reset to default{changed ? ` · ${changed} changed` : ""}
          </button>
        }
      >
        <div className="grid gap-2 p-4 sm:grid-cols-2 xl:grid-cols-3">
          {APPEARANCE_PRESETS.map((p) => {
            const on = p.id === activePreset;
            const pal = p.values.palette ?? "neon";
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => applyPreset(p.id)}
                className="flex cursor-pointer flex-col gap-1.5 rounded-xl border px-3 py-2.5 text-left transition-colors hover:bg-white/[0.04]"
                style={{ borderColor: on ? "var(--page-accent)" : "var(--color-line)" }}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold" style={{ color: on ? "var(--page-accent)" : "var(--color-ink)" }}>
                    {p.name}
                  </span>
                  <Swatch colors={PALETTE_SWATCH[pal]} />
                </span>
                <span className="text-[11px] leading-4 text-ink-faint">{p.blurb}</span>
                {p.theme && <span className="font-mono text-[10px] text-ink-faint">{p.theme} theme</span>}
              </button>
            );
          })}
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-4">
          {GROUPS.map((g) => (
            <Panel key={g} title={g}>
              <div className="flex flex-col p-4">
                {g === "Look" && (
                  <OptionRow label="Theme" hint="Dark, light, or follow your Windows setting.">
                    <Segment choices={THEME_CHOICES} value={theme} onPick={(v) => update({}, v as ThemeChoice)} />
                  </OptionRow>
                )}
                {APPEARANCE_OPTIONS.filter((o) => o.group === g).map((o) => (
                  <OptionRow key={o.key} label={o.label} hint={o.hint}>
                    <Segment
                      choices={o.choices}
                      value={appearance[o.key]}
                      onPick={(v) => update({ [o.key]: v } as Partial<Appearance>)}
                      render={renderChoice(o)}
                    />
                  </OptionRow>
                ))}
              </div>
            </Panel>
          ))}
          <p className="px-1 text-[11px] text-ink-faint">
            Saved in this browser. Each browser or machine keeps its own look, the same way the light/dark toggle does.
          </p>
        </div>

        <div className="flex flex-col gap-4 xl:sticky xl:top-4 xl:self-start">
          <Preview />
        </div>
      </div>
    </div>
  );
}

function OptionRow({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2 border-b border-line py-3 first:pt-0 last:border-b-0 last:pb-0 lg:grid-cols-[220px_minmax(0,1fr)] lg:items-center">
      <div>
        <p className="text-sm font-semibold text-ink">{label}</p>
        <p className="text-[11px] leading-4 text-ink-faint">{hint}</p>
      </div>
      {children}
    </div>
  );
}

/** A small sample of real deck components, so font/color/shape changes are easy to judge. */
function Preview() {
  const pills: { accent: Accent; text: string }[] = [
    { accent: "violet", text: "Claude" },
    { accent: "lime", text: "Codex" },
    { accent: "amber", text: "Running" },
    { accent: "rose", text: "Needs you" },
    { accent: "cyan", text: "Mission" },
    { accent: "magenta", text: "Memory" },
  ];
  return (
    <Panel title="Live preview">
      <div className="flex flex-col gap-3 p-4">
        <div className="grid grid-cols-2 gap-2">
          <GlowTile accent="amber" label="Running now" value={3} />
          <GlowTile accent="lime" label="Done today" value={27} />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {pills.map((p) => (
            <span
              key={p.text}
              className="rounded-md px-1.5 py-0.5 font-mono text-[10px] font-bold"
              style={{ background: ACCENTS[p.accent].soft, color: ACCENTS[p.accent].base }}
            >
              {p.text}
            </span>
          ))}
        </div>
        <div className="rounded-xl border border-line px-3 py-2">
          <p className="flex items-center gap-2 text-xs font-semibold text-ink">
            <StatusOrb accent="amber" pulsing size={7} /> Sessions page build
          </p>
          <p className="pt-0.5 font-mono text-[10px] text-ink-faint">mission-control · 14:02 · 1.2M tokens</p>
        </div>
        <p className="text-sm leading-6 text-ink">
          The quick brown fox jumps over the lazy dog. <span className="text-ink-dim">Secondary text reads like this,</span>{" "}
          <span className="text-ink-faint">and hints like this.</span>
        </p>
        <p className="font-mono text-xs text-ink-dim">claude -p --resume 53fe23ad · 0123456789</p>
        <button
          type="button"
          className="cursor-pointer rounded-lg px-3 py-2 font-mono text-[11px] font-bold"
          style={{ background: ACCENTS.violet.soft, color: ACCENTS.violet.base, border: `1px solid ${ACCENTS.violet.border}` }}
        >
          Sample button
        </button>
      </div>
    </Panel>
  );
}
