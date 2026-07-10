"use client";

import { motion } from "framer-motion";
import { useId, type ReactNode } from "react";
import { ACCENTS, type Accent } from "@/lib/accents";

/** Circular progress ring with a glowing head dot and free-form center content. */
export default function RingDial({
  frac,
  accent = "cyan",
  size = 120,
  stroke = 8,
  label,
  children,
}: {
  frac: number; // 0..1
  accent?: Accent;
  size?: number;
  stroke?: number;
  label?: string;
  children?: ReactNode;
}) {
  const id = useId();
  const c = ACCENTS[accent];
  const f = Math.min(1, Math.max(0, frac));
  const r = 50 - stroke / 2 - 2;
  const headAngle = -90 + 360 * f;
  const hx = 50 + r * Math.cos((headAngle * Math.PI) / 180);
  const hy = 50 + r * Math.sin((headAngle * Math.PI) / 180);

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative" style={{ width: size, height: size }}>
        <svg viewBox="0 0 100 100" width={size} height={size} className="-rotate-90">
          <defs>
            <linearGradient id={`${id}-ring`} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={c.gradFrom} />
              <stop offset="100%" stopColor={c.gradTo} />
            </linearGradient>
          </defs>
          <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(148,163,255,0.12)" strokeWidth={stroke} />
          <motion.circle
            cx="50"
            cy="50"
            r={r}
            fill="none"
            stroke={`url(#${id}-ring)`}
            strokeWidth={stroke}
            strokeLinecap="round"
            pathLength={1}
            strokeDasharray="1"
            initial={{ strokeDashoffset: 1 }}
            animate={{ strokeDashoffset: 1 - f }}
            transition={{ type: "spring", stiffness: 55, damping: 16 }}
          />
        </svg>
        {/* head dot */}
        <motion.span
          aria-hidden
          className="absolute h-2 w-2 rounded-full"
          style={{
            background: c.base,
            boxShadow: `0 0 10px ${c.glow}`,
            left: `${((50 + (hx - 50)) / 100) * 100}%`,
            top: `${hy}%`,
            transform: "translate(-50%, -50%)",
          }}
          animate={{ left: `${hx}%`, top: `${hy}%` }}
          transition={{ type: "spring", stiffness: 55, damping: 16 }}
        />
        <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
      </div>
      {label && <span className="panel-title">{label}</span>}
    </div>
  );
}
