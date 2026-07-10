"use client";

import { useId } from "react";
import { ACCENTS, type Accent } from "@/lib/accents";

/** Area sparkline for rolling telemetry. Values are auto-scaled to their range. */
export default function Sparkline({
  data,
  accent = "cyan",
  width = 220,
  height = 48,
  max,
}: {
  data: number[];
  accent?: Accent;
  width?: number;
  height?: number;
  max?: number;
}) {
  const id = useId();
  const c = ACCENTS[accent];
  const w = 100;
  const h = 32;

  if (data.length < 2) {
    return <div style={{ width, height }} className="rounded bg-white/[0.02]" />;
  }

  const hi = max ?? Math.max(...data, 1);
  const lo = max !== undefined ? 0 : Math.min(...data);
  const range = hi - lo || 1;
  const pts = data.map((v, i) => ({
    x: (i / (data.length - 1)) * w,
    y: h - 3 - ((v - lo) / range) * (h - 6),
  }));
  const line = pts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
  const area = `${line} ${w},${h} 0,${h}`;
  const last = pts[pts.length - 1];

  return (
    <svg width={width} height={height} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={c.base} stopOpacity="0.35" />
          <stop offset="100%" stopColor={c.base} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${id}-fill)`} />
      <polyline points={line} fill="none" stroke={c.base} strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
      <circle cx={last.x} cy={last.y} r="2" fill={c.base} />
    </svg>
  );
}
