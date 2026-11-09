"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Panel from "../ui/Panel";
import type { HubSnapshot } from "@/lib/activity";

/**
 * Small, real-data charts for the hub:
 *   ActivityChart  new sessions per day, stacked by machine (Command)
 *   Sparkbars      a tiny week-by-week bar strip (project rows)
 *   MiniBars       7-day bars inside a KPI tile
 * Series colors are --series-1..4 (validated for colorblind separation in both
 * themes, see globals.css); a machine keeps its color whatever is filtered.
 */

const DAY = 86_400_000;
const startOfDay = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
const dayLabel = (t: number) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/** Top-rounded bar path (4px data-end, square on the baseline side). */
function barPath(x: number, y: number, w: number, h: number, r: number): string {
  if (h <= 0) return "";
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((e) => setW(Math.floor(e[0].contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

// ─── new sessions per day, by machine ───

export function ActivityChart({ hub, days = 14 }: { hub: HubSnapshot | null; days?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);

  const data = useMemo(() => {
    if (!hub) return null;
    const today = startOfDay(Date.now());
    const first = today - (days - 1) * DAY;
    // machines in a fixed order (this one first, then by name) so each keeps its color
    const labelOf = new Map<string, string>([[hub.host, "This machine"], ...hub.machines.map((m) => [m.host, m.label] as [string, string])]);
    const hosts = [...new Set(hub.sessions.map((s) => s.host))].sort((a, b) => (a === hub.host ? -1 : b === hub.host ? 1 : (labelOf.get(a) ?? a).localeCompare(labelOf.get(b) ?? b)));
    const series = hosts.slice(0, 4).map((h, i) => ({ key: h, label: labelOf.get(h) ?? h, color: `var(--series-${i + 1})` }));
    if (hosts.length > 4) series.push({ key: "__other", label: "Other machines", color: "var(--series-other)" });
    const slotOf = (h: string) => (hosts.indexOf(h) < 4 ? h : "__other");
    const cols = Array.from({ length: days }, (_, i) => ({ t: first + i * DAY, counts: Object.fromEntries(series.map((s) => [s.key, 0])) as Record<string, number> }));
    for (const s of hub.sessions) {
      if (s.indexing || !s.startedAt || s.startedAt < first) continue;
      const i = Math.floor((startOfDay(s.startedAt) - first) / DAY);
      if (i >= 0 && i < days) cols[i].counts[slotOf(s.host)]++;
    }
    const totals = Object.fromEntries(series.map((s) => [s.key, cols.reduce((n, c) => n + c.counts[s.key], 0)]));
    const max = Math.max(1, ...cols.map((c) => Object.values(c.counts).reduce((a, b) => a + b, 0)));
    return { series, cols, totals, max };
  }, [hub, days]);

  const H = 150;
  const pad = { l: 26, r: 6, t: 8, b: 20 };
  const plotW = Math.max(0, width - pad.l - pad.r);
  const plotH = H - pad.t - pad.b;
  const step = data ? plotW / data.cols.length : 0;
  const barW = Math.max(4, Math.min(28, step * 0.62));
  const niceMax = data ? Math.max(2, Math.ceil(data.max / 2) * 2) : 2;
  const y = (v: number) => pad.t + plotH - (v / niceMax) * plotH;
  const total = data ? Object.values(data.totals).reduce((a, b) => a + b, 0) : 0;

  return (
    <Panel
      title={`New sessions by machine · last ${days} days`}
      right={
        <button type="button" onClick={() => setTable((v) => !v)} className="cursor-pointer rounded-md border border-line px-2 py-0.5 font-mono text-[10px] text-ink-dim hover:bg-white/[0.06]">
          {table ? "Chart" : "Table"}
        </button>
      }
    >
      <div className="flex flex-col gap-3 p-4">
        {/* legend: always present for 2+ machines, with each machine's total */}
        {data && data.series.length > 1 && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-dim">
            {data.series.map((s) => (
              <span key={s.key} className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: s.color }} />
                {s.label} <span className="font-semibold text-ink">{data.totals[s.key]}</span>
              </span>
            ))}
            <span className="text-ink-faint">· {total} in all</span>
          </div>
        )}
        {table && data ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px]">
              <thead>
                <tr className="text-ink-faint">
                  <th className="py-1 pr-3 font-semibold">Day</th>
                  {data.series.map((s) => (
                    <th key={s.key} className="py-1 pr-3 text-right font-semibold">
                      {s.label}
                    </th>
                  ))}
                  <th className="py-1 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody>
                {[...data.cols].reverse().map((c) => (
                  <tr key={c.t} className="border-t border-line">
                    <td className="py-1 pr-3 text-ink-dim">{dayLabel(c.t)}</td>
                    {data.series.map((s) => (
                      <td key={s.key} className="py-1 pr-3 text-right font-mono text-ink">
                        {c.counts[s.key]}
                      </td>
                    ))}
                    <td className="py-1 text-right font-mono font-semibold text-ink">{Object.values(c.counts).reduce((a, b) => a + b, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div ref={ref} className="relative w-full" style={{ height: H }} onMouseLeave={() => setHover(null)}>
            {data && width > 0 && (
              <svg width={width} height={H} role="img" aria-label={`New sessions per day by machine, last ${days} days: ${total} in all`}>
                {/* recessive grid + y labels */}
                {[0, niceMax / 2, niceMax].map((v) => (
                  <g key={v}>
                    <line x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} stroke="var(--color-line)" strokeWidth={1} strokeDasharray={v === 0 ? undefined : "2 4"} />
                    <text x={pad.l - 6} y={y(v) + 3} textAnchor="end" fontSize="9.5" fill="var(--color-ink-faint)">
                      {v}
                    </text>
                  </g>
                ))}
                {data.cols.map((c, i) => {
                  const x = pad.l + i * step + (step - barW) / 2;
                  let acc = 0;
                  const stack = data.series.filter((s) => c.counts[s.key] > 0);
                  return (
                    <g key={c.t} opacity={hover === null || hover === i ? 1 : 0.45}>
                      {stack.map((s, k) => {
                        const v = c.counts[s.key];
                        const top = y(acc + v);
                        const bottom = y(acc);
                        acc += v;
                        // 2px surface gap between stacked segments; only the top segment gets the rounded data-end
                        const h = Math.max(0, bottom - top - (k > 0 ? 2 : 0));
                        return k === stack.length - 1 ? (
                          <path key={s.key} d={barPath(x, top, barW, h, 4)} fill={s.color} />
                        ) : (
                          <rect key={s.key} x={x} y={top} width={barW} height={h} fill={s.color} />
                        );
                      })}
                      {(i % 2 === (data.cols.length - 1) % 2 || data.cols.length <= 8) && (
                        <text x={x + barW / 2} y={H - 5} textAnchor="middle" fontSize="9.5" fill="var(--color-ink-faint)">
                          {dayLabel(c.t)}
                        </text>
                      )}
                      {/* hit target: the whole column */}
                      <rect x={pad.l + i * step} y={pad.t} width={step} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} />
                    </g>
                  );
                })}
              </svg>
            )}
            {data && hover !== null && (
              <div
                className="pointer-events-none absolute z-10 min-w-[150px] rounded-lg border border-line px-3 py-2 text-[11px] shadow-lg"
                style={{
                  background: "var(--color-panel)",
                  left: Math.min(Math.max(0, pad.l + hover * step + step / 2 - 75), Math.max(0, width - 160)),
                  top: 0,
                }}
              >
                <p className="pb-1 font-semibold text-ink">{dayLabel(data.cols[hover].t)}</p>
                {data.series.map((s) => (
                  <p key={s.key} className="flex items-center justify-between gap-3 text-ink-dim">
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block h-2 w-2 rounded-[2px]" style={{ background: s.color }} />
                      {s.label}
                    </span>
                    <span className="font-mono text-ink">{data.cols[hover].counts[s.key]}</span>
                  </p>
                ))}
              </div>
            )}
            {!data && <p className="text-[11px] text-ink-faint">Loading…</p>}
          </div>
        )}
      </div>
    </Panel>
  );
}

// ─── tiny bar strips ───

/** Week-by-week (or any) counts as a tiny bar strip; a single series in the page color. */
export function Sparkbars({ values, label, width = 56, height = 16 }: { values: number[]; label: string; width?: number; height?: number }) {
  const max = Math.max(1, ...values);
  const gap = 2;
  const w = (width - gap * (values.length - 1)) / values.length;
  return (
    <svg width={width} height={height} role="img" aria-label={label} className="shrink-0">
      <title>{label}</title>
      {values.map((v, i) => {
        const h = v === 0 ? 1.5 : Math.max(2.5, (v / max) * height);
        return <path key={i} d={barPath(i * (w + gap), height - h, w, h, 1.5)} fill={v === 0 ? "var(--color-line-bright)" : "var(--page-accent, var(--ac-cyan))"} opacity={v === 0 ? 0.6 : 0.35 + 0.65 * (v / max)} />;
      })}
    </svg>
  );
}

/** Last-7-days strip inside a KPI tile, today on the right. */
export function MiniBars({ values, color, label }: { values: number[]; color: string; label: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const max = Math.max(1, ...values);
  const H = 16;
  const gap = 3;
  const w = width ? (width - gap * (values.length - 1)) / values.length : 0;
  return (
    <div ref={ref} className="w-full" title={label}>
      {width > 0 && (
        <svg width={width} height={H} role="img" aria-label={label}>
          {values.map((v, i) => {
            const h = v === 0 ? 1.5 : Math.max(3, (v / max) * H);
            return <path key={i} d={barPath(i * (w + gap), H - h, w, h, 2)} fill={v === 0 ? "var(--color-line-bright)" : color} opacity={i === values.length - 1 ? 1 : 0.55} />;
          })}
        </svg>
      )}
    </div>
  );
}

/** Counts per day for the last n days (oldest first), from timestamps. */
export function perDay(timestamps: number[], n = 7): number[] {
  const today = startOfDay(Date.now());
  const out = new Array(n).fill(0);
  for (const t of timestamps) {
    const i = n - 1 - Math.floor((today - startOfDay(t)) / DAY);
    if (i >= 0 && i < n) out[i]++;
  }
  return out;
}

/** Counts per week for the last n weeks (oldest first). */
export function perWeek(timestamps: number[], n = 8): number[] {
  const now = Date.now();
  const out = new Array(n).fill(0);
  for (const t of timestamps) {
    const i = n - 1 - Math.floor((now - t) / (7 * DAY));
    if (i >= 0 && i < n) out[i]++;
  }
  return out;
}
