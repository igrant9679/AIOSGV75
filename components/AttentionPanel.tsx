"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ACCENTS, type Accent } from "@/lib/accents";
import type { AttentionItem } from "@/lib/attention";
import Panel from "./ui/Panel";
import StatusOrb from "./ui/StatusOrb";
import { IconCheck } from "./icons";

const KIND_META: Record<AttentionItem["kind"], { accent: Accent; href: string }> = {
  approval: { accent: "amber", href: "/" }, // resolved from the global ApprovalsBar
  mission_error: { accent: "rose", href: "/missions" },
  mission_stalled: { accent: "amber", href: "/missions" },
  schedule_failed: { accent: "rose", href: "/schedule" },
};

function ago(ts: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export default function AttentionPanel({ delay = 0 }: { delay?: number }) {
  const [items, setItems] = useState<AttentionItem[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/attention");
      if (res.ok) setItems(((await res.json()) as { items: AttentionItem[] }).items ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 20_000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <Panel
      title="Needs Attention"
      right={
        items.length > 0 ? (
          <span
            className="rounded-full px-2 py-0.5 font-mono text-[10px] font-bold"
            style={{ background: ACCENTS.amber.soft, color: ACCENTS.amber.base }}
          >
            {items.length}
          </span>
        ) : undefined
      }
      delay={delay}
    >
      <div className="flex flex-col gap-2 p-4">
        {items.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-5">
            <div className="relative flex h-14 w-14 items-center justify-center">
              <span aria-hidden className="absolute inset-0 rounded-full" style={{ background: ACCENTS.lime.soft }} />
              <span
                aria-hidden
                className="absolute inset-0 rounded-full border"
                style={{ borderColor: ACCENTS.lime.border, animation: "pulse-ring 2.8s ease-out infinite" }}
              />
              <IconCheck width={22} height={22} style={{ color: ACCENTS.lime.base }} />
            </div>
            <p className="font-mono text-[11px] font-bold tracking-[0.22em]" style={{ color: ACCENTS.lime.base }}>
              ALL SYSTEMS NOMINAL
            </p>
            <p className="text-[11px] text-ink-faint">Nothing is blocked on you.</p>
          </div>
        )}
        {items.slice(0, 8).map((item) => {
          const meta = KIND_META[item.kind];
          const c = ACCENTS[meta.accent];
          return (
            <Link
              key={`${item.kind}-${item.id}`}
              href={meta.href}
              className="block rounded-xl border border-line px-3 py-2 transition-colors hover:border-line-bright"
              style={{
                borderLeft: `3px solid ${c.base}`,
                background: `radial-gradient(140px 60px at 0% 50%, ${c.soft}, transparent 75%)`,
              }}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  <StatusOrb accent={meta.accent} size={7} />
                  <span className="truncate text-xs font-semibold text-ink">{item.label}</span>
                </span>
                <span className="shrink-0 font-mono text-[10px]" style={{ color: c.base }}>
                  {ago(item.ts)}
                </span>
              </span>
              <span className="block truncate pt-0.5 text-[11px] text-ink-faint">{item.detail}</span>
            </Link>
          );
        })}
        {items.length > 8 && <p className="text-center font-mono text-[10px] text-ink-faint">+{items.length - 8} more</p>}
      </div>
    </Panel>
  );
}
