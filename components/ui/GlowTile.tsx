"use client";

import type { ReactNode } from "react";
import { ACCENTS, type Accent } from "@/lib/accents";

/** Stat tile with a soft accent glow bleeding in from the top-right corner. */
export default function GlowTile({
  accent,
  label,
  value,
  children,
  className = "",
}: {
  accent: Accent;
  label: string;
  value: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const c = ACCENTS[accent];
  return (
    <div
      className={`relative overflow-hidden rounded-xl border border-line p-3 ${className}`}
      style={{ background: `radial-gradient(130px 80px at 100% 0%, ${c.soft}, transparent 70%)` }}
    >
      <p className="panel-title">{label}</p>
      <p className="mt-1 font-mono text-2xl font-bold" style={{ color: c.base }}>
        {value}
      </p>
      {children && <div className="mt-2 flex h-4 items-center">{children}</div>}
    </div>
  );
}
