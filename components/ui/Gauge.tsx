"use client";

import { motion } from "framer-motion";
import { useId } from "react";
import { ACCENTS, type Accent } from "@/lib/accents";
import NumberTicker from "./NumberTicker";

const CX = 100;
const CY = 104;
const R = 74;
const SWEEP = 240; // degrees of arc
const START = 210; // math-convention degrees; sweeps clockwise to -30

function polar(angleDeg: number, radius: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: CX + radius * Math.cos(rad), y: CY - radius * Math.sin(rad) };
}

const arcStart = polar(START, R);
const arcEnd = polar(START - SWEEP, R);
const ARC_PATH = `M ${arcStart.x} ${arcStart.y} A ${R} ${R} 0 1 1 ${arcEnd.x} ${arcEnd.y}`;

/** 240° radial gauge with gradient arc, ticks, and a sprung needle. */
export default function Gauge({
  value,
  max = 100,
  label,
  unit = "",
  accent = "cyan",
  decimals = 0,
  size = 180,
}: {
  value: number;
  max?: number;
  label: string;
  unit?: string;
  accent?: Accent;
  decimals?: number;
  size?: number;
}) {
  const id = useId();
  const c = ACCENTS[accent];
  const frac = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const needleDeg = -120 + 240 * frac; // svg rotation: clockwise-positive

  const ticks = Array.from({ length: 13 }, (_, i) => {
    const a = START - (SWEEP * i) / 12;
    const major = i % 3 === 0;
    const p1 = polar(a, R + 8);
    const p2 = polar(a, R + (major ? 16 : 12));
    return { p1, p2, major, key: i };
  });

  return (
    <div
      className="flex flex-col items-center"
      role="meter"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={max}
    >
      <svg width={size} height={size * 0.78} viewBox="0 0 200 156">
        <defs>
          <linearGradient id={`${id}-arc`} x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={c.gradFrom} />
            <stop offset="100%" stopColor={c.gradTo} />
          </linearGradient>
          <filter id={`${id}-glow`} x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* ticks */}
        {ticks.map((t) => (
          <line
            key={t.key}
            x1={t.p1.x}
            y1={t.p1.y}
            x2={t.p2.x}
            y2={t.p2.y}
            stroke={t.major ? "rgba(148,163,255,0.5)" : "rgba(148,163,255,0.22)"}
            strokeWidth={t.major ? 2 : 1}
            strokeLinecap="round"
          />
        ))}

        {/* track */}
        <path d={ARC_PATH} fill="none" stroke="rgba(148,163,255,0.12)" strokeWidth={10} strokeLinecap="round" />

        {/* value arc */}
        <motion.path
          d={ARC_PATH}
          fill="none"
          stroke={`url(#${id}-arc)`}
          strokeWidth={10}
          strokeLinecap="round"
          filter={`url(#${id}-glow)`}
          pathLength={1}
          strokeDasharray="1"
          initial={{ strokeDashoffset: 1 }}
          animate={{ strokeDashoffset: 1 - frac }}
          transition={{ type: "spring", stiffness: 60, damping: 18 }}
        />

        {/* needle */}
        <motion.g
          initial={{ rotate: -120 }}
          animate={{ rotate: needleDeg }}
          transition={{ type: "spring", stiffness: 70, damping: 14 }}
          style={{ originX: "100px", originY: `${CY}px` }}
        >
          <polygon points={`${CX - 3},${CY} ${CX + 3},${CY} ${CX},${CY - R + 16}`} fill={c.base} opacity={0.95} />
        </motion.g>
        <circle cx={CX} cy={CY} r={6} fill="#0c0f20" stroke={c.base} strokeWidth={2} />

        {/* value */}
        <foreignObject x={30} y={CY + 8} width={140} height={40}>
          <div className="text-center font-mono text-[20px] font-semibold" style={{ color: c.base }}>
            <NumberTicker value={value} decimals={decimals} suffix={unit} />
          </div>
        </foreignObject>
      </svg>
      <span className="panel-title -mt-1">{label}</span>
    </div>
  );
}
