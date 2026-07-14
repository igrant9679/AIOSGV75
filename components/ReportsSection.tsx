"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { motion } from "framer-motion";
import { ACCENTS, type Accent } from "@/lib/accents";
import type { ReportData, ReportDef } from "@/lib/reports";
import Panel from "./ui/Panel";
import GlowTile from "./ui/GlowTile";
import EmptyState from "./ui/EmptyState";
import Markdown from "./Markdown";
import { useMission } from "./store";
import { IconPulse } from "./icons";

const CATEGORIES: { id: ReportDef["category"]; label: string }[] = [
  { id: "operations", label: "Operations" },
  { id: "brain", label: "The Brain" },
  { id: "quality", label: "Quality" },
  { id: "output", label: "Output" },
];

const accentVar = (a: Accent): CSSProperties => ({ "--page-accent": ACCENTS[a].base }) as CSSProperties;

function BarRows({ chart }: { chart: ReportData["charts"][number] }) {
  const max = Math.max(...chart.bars.map((b) => b.value), 1);
  return (
    <div className="flex flex-col gap-1.5">
      {chart.bars.map((b, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-28 shrink-0 truncate text-right font-mono text-[10px] text-ink-dim" title={b.label}>
            {b.label}
          </span>
          <div className="h-3 flex-1 overflow-hidden rounded-full bg-white/5">
            <div
              className="h-full rounded-full transition-[width] duration-500"
              style={{
                width: `${Math.max(2, (b.value / max) * 100)}%`,
                background: `linear-gradient(90deg, var(--page-accent, var(--ac-cyan)), color-mix(in srgb, var(--page-accent, var(--ac-cyan)) 45%, transparent))`,
              }}
            />
          </div>
          <span className="w-16 shrink-0 font-mono text-[10px] tabular-nums text-ink-dim">
            {chart.unit === "$" ? `$${b.value.toFixed(2)}` : Math.round(b.value * 10) / 10}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function ReportsSection() {
  const { addEvent } = useMission();
  const [defs, setDefs] = useState<ReportDef[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [report, setReport] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch("/api/reports")
      .then((r) => r.json())
      .then((j: { reports: ReportDef[] }) => setDefs(j.reports ?? []))
      .catch(() => {});
  }, []);

  const open = useCallback(async (id: string) => {
    setActive(id);
    setReport(null);
    setErr("");
    setLoading(true);
    try {
      const res = await fetch(`/api/reports?id=${encodeURIComponent(id)}`);
      const j = (await res.json()) as { report?: ReportData; error?: string };
      if (!res.ok || !j.report) setErr(j.error ?? "failed to build report");
      else setReport(j.report);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const saveToVault = async () => {
    if (!report) return;
    setSaving(true);
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: report.id, action: "vault" }),
      });
      const j = (await res.json()) as { ok?: boolean; file?: string; error?: string };
      if (j.ok) addEvent("REPORTS", `Saved to vault: ${j.file}`, "lime");
      else setErr(j.error ?? "save failed");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const def = defs.find((d) => d.id === active);

  return (
    <div className="flex flex-col gap-4">
      {/* catalog */}
      {CATEGORIES.map((cat, ci) => {
        const list = defs.filter((d) => d.category === cat.id);
        if (!list.length) return null;
        return (
          <Panel key={cat.id} title={cat.label} delay={ci * 0.04}>
            <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((d) => {
                const c = ACCENTS[d.accent];
                const on = active === d.id;
                return (
                  <motion.button
                    key={d.id}
                    whileHover={{ y: -2 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => open(d.id)}
                    className="cursor-pointer rounded-xl border p-3 text-left transition-colors"
                    style={{
                      borderColor: on ? c.border : "var(--color-line)",
                      background: `radial-gradient(140px 70px at 100% 0%, ${c.soft}, transparent 75%)`,
                    }}
                  >
                    <span className="flex items-center gap-2">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full" style={{ background: c.soft, color: c.base }}>
                        <IconPulse width={13} height={13} />
                      </span>
                      <span className="text-sm font-semibold" style={{ color: c.base }}>
                        {d.title}
                      </span>
                    </span>
                    <span className="mt-1.5 block text-[11px] leading-4 text-ink-faint">{d.tagline}</span>
                  </motion.button>
                );
              })}
            </div>
          </Panel>
        );
      })}

      {/* viewer */}
      {active && def && (
        <div style={accentVar(def.accent)}>
          <Panel
            title={def.title}
            right={
              report ? (
                <span className="flex items-center gap-2">
                  <a
                    href={`/api/reports/export?id=${report.id}&format=md`}
                    className="cursor-pointer rounded-md border border-line px-2 py-1 font-mono text-[10px] text-ink-dim transition-colors hover:bg-white/[0.06]"
                  >
                    ↓ Markdown
                  </a>
                  <a
                    href={`/api/reports/export?id=${report.id}&format=html`}
                    className="cursor-pointer rounded-md border border-line px-2 py-1 font-mono text-[10px] text-ink-dim transition-colors hover:bg-white/[0.06]"
                  >
                    ↓ HTML
                  </a>
                  <button
                    onClick={saveToVault}
                    disabled={saving}
                    className="cursor-pointer rounded-md border border-line px-2 py-1 font-mono text-[10px] text-neon-lime transition-colors hover:bg-white/[0.06] disabled:opacity-40"
                  >
                    {saving ? "Saving…" : "⊕ Save to vault"}
                  </button>
                  <button
                    onClick={() => open(active)}
                    className="cursor-pointer rounded-md border border-line px-2 py-1 font-mono text-[10px] text-ink-dim transition-colors hover:bg-white/[0.06]"
                  >
                    ↻
                  </button>
                </span>
              ) : undefined
            }
            delay={0}
          >
            <div className="flex flex-col gap-4 p-4">
              {err && (
                <p role="alert" className="rounded-lg border border-neon-rose/30 bg-neon-rose/10 px-3 py-2 font-mono text-[11px] text-neon-rose">
                  {err}
                </p>
              )}
              {loading && <EmptyState accent={def.accent} title="Compiling report" hint="Reducing the data stores…" />}

              {report && (
                <>
                  <p className="font-mono text-[10px] tracking-[0.18em] text-ink-faint">
                    {def.tagline.toUpperCase()} · GENERATED{" "}
                    {new Date(report.generatedAt).toLocaleString("en-US", { hour12: false })}
                  </p>

                  {report.kpis.length > 0 && (
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                      {report.kpis.map((k) => (
                        <GlowTile key={k.label} accent={k.accent ?? def.accent} label={k.label} value={k.value}>
                          {k.hint && <span className="truncate font-mono text-[9px] text-ink-faint">{k.hint.toUpperCase()}</span>}
                        </GlowTile>
                      ))}
                    </div>
                  )}

                  <div className="grid gap-4 lg:grid-cols-2">
                    {report.charts
                      .filter((c) => c.bars.length)
                      .map((c) => (
                        <div key={c.title} className="rounded-xl border border-line p-3">
                          <p className="panel-title mb-2.5">{c.title}</p>
                          <BarRows chart={c} />
                        </div>
                      ))}
                  </div>

                  {report.tables
                    .filter((t) => t.rows.length)
                    .map((t) => (
                      <div key={t.title} className="overflow-x-auto rounded-xl border border-line p-3">
                        <p className="panel-title mb-2">{t.title}</p>
                        <table className="w-full text-left font-mono text-[11px]">
                          <thead>
                            <tr>
                              {t.columns.map((c) => (
                                <th key={c} className="border-b border-line px-2 py-1.5 text-[9.5px] uppercase tracking-[0.12em] text-ink-faint">
                                  {c}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {t.rows.map((row, ri) => (
                              <tr key={ri} className="hover:bg-white/[0.02]">
                                {row.map((cell, ci2) => (
                                  <td key={ci2} className="border-b border-line/50 px-2 py-1.5 text-ink-dim">
                                    {cell}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ))}

                  {report.notes.length > 0 && (
                    <div className="flex flex-col gap-1.5 rounded-xl border border-line p-3">
                      <p className="panel-title mb-1">Notes</p>
                      {report.notes.map((n, i) => (
                        <div key={i} className="text-[12px] leading-5 text-ink-dim">
                          <Markdown>{`- ${n}`}</Markdown>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </Panel>
        </div>
      )}

      {!active && defs.length > 0 && (
        <p className="text-center font-mono text-[10px] tracking-[0.2em] text-ink-faint">
          PICK A REPORT · EVERY ONE EXPORTS AS MARKDOWN · HTML (PRINT → PDF) · OR A VAULT NOTE
        </p>
      )}
    </div>
  );
}
