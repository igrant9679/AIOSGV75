"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Sorting for the second-brain lists. Each list declares its sort keys; the
 * choice (key + direction) is remembered per list in this browser, like the
 * other per-viewer conveniences (theme, appearance).
 */

export type SortDir = "asc" | "desc";

export interface SortOption<T> {
  id: string;
  label: string;
  /** value to compare; missing values always sort last */
  get: (item: T) => number | string | undefined | null;
  /** direction picked when you switch to this key (dates/counts: desc, names: asc) */
  dir: SortDir;
  /** true = time-based, so day grouping still makes sense */
  time?: boolean;
}

interface Saved {
  by: string;
  dir: SortDir;
}

const KEY = (list: string) => `mc-sort:${list}`;

function readSaved(list: string): Saved | null {
  try {
    const raw = localStorage.getItem(KEY(list));
    if (!raw) return null;
    const s = JSON.parse(raw) as Saved;
    return s && typeof s.by === "string" && (s.dir === "asc" || s.dir === "desc") ? s : null;
  } catch {
    return null;
  }
}

export function sortBy<T>(items: T[], opt: SortOption<T>, dir: SortDir): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...items].sort((a, b) => {
    const va = opt.get(a);
    const vb = opt.get(b);
    const ea = va === undefined || va === null || va === "" || (typeof va === "number" && !Number.isFinite(va));
    const eb = vb === undefined || vb === null || vb === "" || (typeof vb === "number" && !Number.isFinite(vb));
    if (ea || eb) return Number(ea) - Number(eb); // blanks last either way
    if (typeof va === "number" && typeof vb === "number") return sign * (va - vb);
    // ignore leading emoji / brackets so "⏰ 🗞 Chief of Staff" files under C
    const text = (v: unknown) => String(v).replace(/^[^\p{L}\p{N}]+/u, "");
    return sign * text(va).localeCompare(text(vb), undefined, { sensitivity: "base", numeric: true });
  });
}

export function useSort<T>(list: string, options: SortOption<T>[], defaultBy?: string) {
  const fallback = options.find((o) => o.id === defaultBy) ?? options[0];
  const [state, setState] = useState<Saved>({ by: fallback.id, dir: fallback.dir });

  // restore after mount (localStorage is client-only)
  useEffect(() => {
    const s = readSaved(list);
    if (s && options.some((o) => o.id === s.by)) setState(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list]);

  const save = useCallback(
    (next: Saved) => {
      setState(next);
      try {
        localStorage.setItem(KEY(list), JSON.stringify(next));
      } catch {
        /* storage blocked — still sorts for this visit */
      }
    },
    [list],
  );

  const option = options.find((o) => o.id === state.by) ?? fallback;
  const apply = useCallback((items: T[]) => sortBy(items, option, state.dir), [option, state.dir]);
  const isDefault = option.id === fallback.id && state.dir === fallback.dir;

  const control = useMemo(
    () => (
      <SortControl
        options={options}
        by={option.id}
        dir={state.dir}
        onBy={(id) => {
          const o = options.find((x) => x.id === id) ?? fallback;
          save({ by: o.id, dir: o.dir });
        }}
        onDir={() => save({ by: option.id, dir: state.dir === "asc" ? "desc" : "asc" })}
        onReset={isDefault ? undefined : () => save({ by: fallback.id, dir: fallback.dir })}
      />
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [option.id, state.dir, isDefault, save],
  );

  return { apply, option, dir: state.dir, control };
}

function dirLabel(dir: SortDir, time?: boolean, text?: boolean): string {
  if (time) return dir === "desc" ? "newest first" : "oldest first";
  if (text) return dir === "asc" ? "A → Z" : "Z → A";
  return dir === "desc" ? "highest first" : "lowest first";
}

export function SortControl<T>({
  options,
  by,
  dir,
  onBy,
  onDir,
  onReset,
}: {
  options: SortOption<T>[];
  by: string;
  dir: SortDir;
  onBy: (id: string) => void;
  onDir: () => void;
  onReset?: () => void;
}) {
  const current = options.find((o) => o.id === by);
  const text = current ? current.dir === "asc" && !current.time : false;
  return (
    <span className="inline-flex items-center gap-1 font-mono text-[10px] text-ink-faint">
      <label className="inline-flex items-center gap-1">
        <span>Sort</span>
        <select
          value={by}
          onChange={(e) => onBy(e.target.value)}
          aria-label="Sort by"
          className="cursor-pointer rounded-md border border-line bg-transparent px-1.5 py-0.5 text-[10px] text-ink-dim outline-none hover:border-line-bright focus:border-line-bright"
        >
          {options.map((o) => (
            <option key={o.id} value={o.id} style={{ background: "var(--color-panel)", color: "var(--color-ink)" }}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        onClick={onDir}
        title={`Order: ${dirLabel(dir, current?.time, text)} — click to flip`}
        aria-label={`Order: ${dirLabel(dir, current?.time, text)}. Click to reverse.`}
        className="cursor-pointer rounded-md border border-line px-1.5 py-0.5 text-ink-dim hover:border-line-bright hover:text-ink"
      >
        {dir === "desc" ? "↓" : "↑"}
      </button>
      {onReset && (
        <button type="button" onClick={onReset} title="Back to the default order" className="cursor-pointer px-1 text-ink-faint hover:text-ink">
          reset
        </button>
      )}
    </span>
  );
}
