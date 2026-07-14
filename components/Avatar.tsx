"use client";

import { ACCENTS, type Accent } from "@/lib/accents";
import { IconSpark, IconClaw, IconWing } from "./icons";
export type { Accent };

export type AvatarKind = "claude" | "openclaw" | "hermes" | "user";

const CONFIG: Record<AvatarKind, { accent: Accent; label: string }> = {
  claude: { accent: "violet", label: "Claude" },
  openclaw: { accent: "magenta", label: "OpenClaw" },
  hermes: { accent: "amber", label: "Hermes" },
  user: { accent: "lime", label: "You" },
};

function Glyph({ kind, size }: { kind: AvatarKind; size: number }) {
  const s = { width: size * 0.52, height: size * 0.52 };
  if (kind === "claude") return <IconSpark {...s} />;
  if (kind === "openclaw") return <IconClaw {...s} />;
  if (kind === "hermes") return <IconWing {...s} />;
  return (
    <svg {...s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" />
    </svg>
  );
}

/**
 * Gradient logo avatar. Known kinds get an icon; custom agents pass `name` +
 * `accent` and get a monogram on the same gradient treatment. `busy` adds a
 * pulsing ring while the agent is streaming a reply.
 */
export default function Avatar({
  kind,
  name,
  accent,
  size = 34,
  busy = false,
}: {
  kind?: AvatarKind;
  name?: string;
  accent?: Accent;
  size?: number;
  busy?: boolean;
}) {
  const known = kind ? CONFIG[kind] : undefined;
  const c = ACCENTS[known?.accent ?? accent ?? "cyan"];
  const label = known?.label ?? name ?? "agent";
  return (
    <span
      role="img"
      aria-label={busy ? `${label} (working)` : label}
      className="relative flex shrink-0 items-center justify-center rounded-full font-display font-bold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.42,
        background: `linear-gradient(135deg, ${c.gradFrom}, ${c.base})`,
        boxShadow: `0 2px 10px ${c.glow.replace("0.55", "0.3")}`,
      }}
    >
      {busy && (
        <span
          aria-hidden
          className="absolute inset-0 animate-ping rounded-full border-2"
          style={{ borderColor: c.base, opacity: 0.6 }}
        />
      )}
      {kind ? <Glyph kind={kind} size={size} /> : (name ?? "?").trim().charAt(0).toUpperCase()}
    </span>
  );
}
