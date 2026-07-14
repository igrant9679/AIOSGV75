"use client";

/** Circular gauge — fills `value/total`, label in the center. */
export default function RingGauge({
  value,
  total,
  color,
  size = 64,
  label,
}: {
  value: number;
  total: number;
  color: string;
  size?: number;
  label?: string;
}) {
  const pct = total > 0 ? Math.min(1, value / total) : 1;
  const r = 24;
  const circ = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 60 60" className="-rotate-90" style={{ width: size, height: size }}>
        <circle cx="30" cy="30" r={r} fill="none" stroke="var(--color-line)" strokeWidth="5" />
        <circle
          cx="30"
          cy="30"
          r={r}
          fill="none"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - pct)}
          style={{ stroke: color, transition: "stroke-dashoffset 0.7s ease" }}
        />
      </svg>
      <span
        className="absolute inset-0 flex items-center justify-center font-mono font-bold"
        style={{ color, fontSize: Math.max(9, size * 0.17) }}
      >
        {label ?? `${Math.round(pct * 100)}%`}
      </span>
    </div>
  );
}
