"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import Panel from "../ui/Panel";
import StatusOrb from "../ui/StatusOrb";
import { ACCENTS, type Accent } from "@/lib/accents";
import type { HealthCheck, HealthLevel, HealthReport, MachineHealth } from "@/lib/health";
import { ago } from "./common";

interface HealthView {
  report: HealthReport;
  settings: { telegram: boolean };
  lastAlertAt?: number;
  machines: MachineHealth[];
  error?: string;
}

const LEVEL: Record<HealthLevel, { accent: Accent; label: string }> = {
  fail: { accent: "rose", label: "Broken" },
  warn: { accent: "amber", label: "Check" },
  ok: { accent: "lime", label: "OK" },
  info: { accent: "violet", label: "Optional" },
  skip: { accent: "cyan", label: "—" },
};

/** `code` spans in fix text → <code>. */
function Rich({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("`") && p.endsWith("`") ? (
          <code key={i} className="rounded bg-white/[0.06] px-1 font-mono text-[11px] text-ink">
            {p.slice(1, -1)}
          </code>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}

function CheckRow({ c }: { c: HealthCheck }) {
  const m = LEVEL[c.level];
  const tone = ACCENTS[m.accent];
  const problem = c.level === "fail" || c.level === "warn";
  const actionable = problem || c.level === "info";
  return (
    <div className="flex gap-3 border-b border-line py-2.5 last:border-b-0">
      <span className="pt-1">
        <StatusOrb accent={m.accent} pulsing={c.level === "fail"} size={7} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-xs font-semibold text-ink">
          {c.label}
          {actionable && (
            <span className="rounded px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-wide" style={{ background: tone.soft, color: tone.base }}>
              {m.label.toUpperCase()}
            </span>
          )}
        </p>
        <p className="pt-0.5 text-[11px] leading-4 text-ink-dim">{c.detail}</p>
        {actionable && c.fix && (
          <p className="pt-1 text-[11px] leading-4 text-ink">
            <span className="font-semibold" style={{ color: tone.base }}>
              {c.level === "info" ? "What to do: " : "Fix: "}
            </span>
            <Rich text={c.fix} />
          </p>
        )}
        {problem && c.impact && <p className="pt-0.5 text-[10px] leading-4 text-ink-faint">While broken: {c.impact}</p>}
        {actionable && c.links && c.links.length > 0 && (
          <p className="flex flex-wrap gap-x-3 gap-y-1 pt-1">
            {c.links.map((l) => (
              <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="font-mono text-[10px] underline decoration-dotted underline-offset-2" style={{ color: tone.base }}>
                {l.label} ↗
              </a>
            ))}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Health — the things that make Mission Control quietly stop working when
 * broken (CLI logins, schedules, vault, daemons, watchdog, machine group,
 * disk). Problems open the panel; all-clear collapses to one line.
 */
export default function HealthPanel() {
  const [view, setView] = useState<HealthView | null>(null);
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [showOptional, setShowOptional] = useState(false);

  const load = useCallback(async (init?: RequestInit) => {
    try {
      const res = await fetch("/api/health", init);
      const body = (await res.json()) as HealthView;
      if (res.ok) setView(body);
      else setView((v) => (v ? { ...v, error: body.error } : v));
    } catch (e) {
      setView((v) => (v ? { ...v, error: (e as Error).message } : v));
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => load(), 60_000);
    return () => clearInterval(t);
  }, [load]);

  const post = async (body: object) => {
    setBusy(true);
    await load({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
  };

  if (!view) {
    return (
      <div className="panel flex items-center gap-2 px-4 py-2.5 font-mono text-[11px] text-ink-faint">
        <StatusOrb accent="cyan" pulsing size={7} /> Checking health…
      </div>
    );
  }

  const { report, settings, machines } = view;
  const problems = report.checks.filter((c) => c.level === "fail" || c.level === "warn");
  const fails = problems.filter((c) => c.level === "fail").length;
  const optional = report.checks.filter((c) => c.level === "info");
  const otherTrouble = machines.filter((m) => !m.self && m.report && (m.report.worst === "fail" || m.report.worst === "warn"));
  const shown = showAll ? report.checks : problems.sort((a, b) => (a.level === "fail" ? -1 : 0) - (b.level === "fail" ? -1 : 0));
  const headAccent: Accent = fails ? "rose" : problems.length ? "amber" : "lime";
  const self = machines.find((m) => m.self);
  const machineName = self?.label ?? report.host;

  const actions = (
    <span className="flex flex-wrap items-center gap-2 font-mono text-[10px] text-ink-faint">
      <span title={new Date(report.checkedAt).toLocaleString()}>checked {ago(report.checkedAt)} ago</span>
      <button
        type="button"
        onClick={() => post({ action: "settings", telegram: !settings.telegram })}
        disabled={busy}
        title="Send a Telegram message when a check starts failing, and when it recovers"
        aria-pressed={settings.telegram}
        className="cursor-pointer rounded-md border px-2 py-0.5 transition-colors hover:bg-white/[0.06]"
        style={{ borderColor: settings.telegram ? ACCENTS.lime.border : "var(--color-line)", color: settings.telegram ? ACCENTS.lime.base : undefined }}
      >
        Telegram alerts {settings.telegram ? "on" : "off"}
      </button>
      <button type="button" onClick={() => setShowAll((v) => !v)} className="cursor-pointer rounded-md border border-line px-2 py-0.5 hover:bg-white/[0.06]">
        {showAll ? "Problems only" : "All checks"}
      </button>
      <button
        type="button"
        onClick={() => post({ action: "run" })}
        disabled={busy}
        className="cursor-pointer rounded-md border border-line px-2 py-0.5 hover:bg-white/[0.06] disabled:opacity-50"
      >
        {busy ? "Checking…" : "Re-check"}
      </button>
    </span>
  );

  // All clear (here and on every machine that reports) → one quiet line.
  if (problems.length === 0 && otherTrouble.length === 0 && !showAll && !showOptional) {
    return (
      <div className="panel flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
        <span className="flex flex-wrap items-center gap-2 text-xs text-ink-dim">
          <StatusOrb accent="lime" size={7} /> All health checks passing on {machineName}
          {machines.length > 1 ? ` · ${machines.filter((m) => m.report).length} of ${machines.length} machines reporting` : ""}
          {optional.length > 0 && (
            <button
              type="button"
              onClick={() => setShowOptional(true)}
              className="cursor-pointer rounded-md border px-2 py-0.5 font-mono text-[10px] transition-colors hover:bg-white/[0.06]"
              style={{ borderColor: ACCENTS.violet.border, color: ACCENTS.violet.base }}
              title={optional.map((c) => c.label).join(", ")}
            >
              {optional.length} optional install{optional.length === 1 ? "" : "s"} available
            </button>
          )}
        </span>
        {actions}
      </div>
    );
  }

  return (
    <Panel
      title={
        problems.length
          ? `Health · ${fails ? `${fails} broken` : ""}${fails && problems.length > fails ? ", " : ""}${problems.length > fails ? `${problems.length - fails} to check` : ""} on ${machineName}`
          : `Health · ${machineName}`
      }
      right={actions}
    >
      <div className="flex flex-col gap-3 p-4">
        {view.error && <p className="font-mono text-[10px] text-ink-faint">Last refresh failed: {view.error}</p>}
        <div className="flex flex-col rounded-xl border px-3" style={{ borderColor: ACCENTS[headAccent].border }}>
          {shown.length === 0 && <p className="py-2.5 text-[11px] text-ink-faint">No problems on this machine.</p>}
          {shown.map((c) => (
            <CheckRow key={c.id} c={c} />
          ))}
        </div>

        {!showAll && optional.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="panel-title flex items-center justify-between">
              <span>Optional installs</span>
              {showOptional && problems.length === 0 && (
                <button type="button" onClick={() => setShowOptional(false)} className="cursor-pointer font-mono text-[10px] normal-case tracking-normal text-ink-faint hover:text-ink">
                  hide
                </button>
              )}
            </p>
            <div className="flex flex-col rounded-xl border px-3" style={{ borderColor: ACCENTS.violet.border }}>
              {optional.map((c) => (
                <CheckRow key={c.id} c={c} />
              ))}
            </div>
          </div>
        )}

        {machines.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="panel-title pr-1">Machines</span>
            {machines.map((m) => {
              const lvl: HealthLevel | undefined = m.report?.worst;
              const accent: Accent = !m.online ? "rose" : lvl ? LEVEL[lvl].accent : "cyan";
              const stale = m.report && Date.now() - m.report.checkedAt > 30 * 60_000;
              const bad = m.report?.checks.filter((c) => c.level === "fail" || c.level === "warn") ?? [];
              const tip = !m.report
                ? "No health report yet — this machine needs the newer Mission Control"
                : `${bad.length ? bad.map((c) => `${c.level === "fail" ? "✖" : "!"} ${c.label}`).join("\n") : "All checks passing"}\nchecked ${ago(m.report.checkedAt)} ago`;
              return (
                <span key={m.host} title={tip} className="inline-flex items-center gap-1.5 rounded-md border border-line px-2 py-1 font-mono text-[10px] text-ink-dim">
                  <StatusOrb accent={accent} size={6} />
                  {m.label}
                  {m.self && <span className="text-ink-faint">(this)</span>}
                  {m.isMaster && <span style={{ color: ACCENTS.amber.base }}>master</span>}
                  {!m.online ? (
                    <span className="text-ink-faint">offline</span>
                  ) : !m.report ? (
                    <span className="text-ink-faint">no report</span>
                  ) : stale ? (
                    <span className="text-ink-faint">stale</span>
                  ) : bad.length ? (
                    <span style={{ color: ACCENTS[accent].base }}>{bad.length} issue{bad.length === 1 ? "" : "s"}</span>
                  ) : null}
                </span>
              );
            })}
          </div>
        )}
      </div>
    </Panel>
  );
}
