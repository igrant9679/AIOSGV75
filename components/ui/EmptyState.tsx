"use client";

import type { ReactNode } from "react";
import { ACCENTS, type Accent } from "@/lib/accents";

/**
 * Shared empty-state: a slow radar ring in the section's accent with a short
 * headline + hint, replacing bare "nothing yet" strings. `compact` drops the
 * emblem for tight spots (kanban lanes, small panels).
 */
export default function EmptyState({
  accent = "cyan",
  title,
  hint,
  compact = false,
  action,
}: {
  accent?: Accent;
  title: string;
  hint?: string;
  compact?: boolean;
  action?: ReactNode;
}) {
  const c = ACCENTS[accent];
  if (compact) {
    return (
      <div className="flex flex-col items-center gap-1 py-5">
        <p className="font-mono text-[10px] tracking-[0.22em] text-ink-faint">{title.toUpperCase()}</p>
        {hint && <p className="text-[11px] text-ink-faint">{hint}</p>}
        {action}
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-2.5 py-8">
      <div className="relative h-16 w-16">
        <svg viewBox="0 0 64 64" className="h-16 w-16" aria-hidden>
          <circle cx="32" cy="32" r="28" fill="none" stroke="var(--color-line)" strokeWidth="1.5" />
          <circle cx="32" cy="32" r="18" fill="none" stroke="var(--color-line)" strokeWidth="1" strokeDasharray="3 5" />
          <circle cx="32" cy="32" r="3" style={{ fill: c.base }} opacity="0.8" />
          <g className="animate-radar" style={{ animationDuration: "6s" }}>
            <path d="M32 32 L32 5 A27 27 0 0 1 51 13 Z" style={{ fill: c.soft }} />
            <line x1="32" y1="32" x2="32" y2="5" style={{ stroke: c.base }} strokeWidth="1.5" opacity="0.8" />
          </g>
        </svg>
      </div>
      <p className="font-mono text-[11px] font-bold tracking-[0.22em]" style={{ color: c.base }}>
        {title.toUpperCase()}
      </p>
      {hint && <p className="max-w-72 text-center text-[11px] leading-4 text-ink-faint">{hint}</p>}
      {action}
    </div>
  );
}
