"use client";

import { ACCENTS, type Accent } from "@/lib/accents";

export default function StatusOrb({
  accent = "lime",
  pulsing = true,
  size = 10,
}: {
  accent?: Accent;
  pulsing?: boolean;
  size?: number;
}) {
  const c = ACCENTS[accent];
  return (
    <span className="relative inline-flex" style={{ width: size, height: size }} aria-hidden>
      {pulsing && (
        <span
          className="absolute inset-0 rounded-full"
          style={{ background: c.base, animation: "pulse-ring 1.8s cubic-bezier(0,0,0.2,1) infinite" }}
        />
      )}
      <span
        className="relative inline-flex rounded-full"
        style={{ width: size, height: size, background: c.base, boxShadow: `0 0 10px ${c.glow}` }}
      />
    </span>
  );
}
