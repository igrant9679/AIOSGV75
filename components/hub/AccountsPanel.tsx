"use client";

import { useMemo } from "react";
import Panel from "../ui/Panel";
import { ACCENTS, type Accent } from "@/lib/accents";
import { accountUsage, type AccountUsage } from "@/lib/accountUsage";
import type { HubSnapshot } from "@/lib/activity";
import { SourcePill, ago, fmtTokens, until } from "./common";

/**
 * Fleet → Accounts: usage per LOGIN, not per machine. The same Claude or ChatGPT account on four
 * machines shares one set of limits; this adds the machines up (lib/accountUsage.ts) so the real
 * headroom shows, and says when the window fills at the current pace.
 */
export default function AccountsPanel({ hub, labelOf }: { hub: HubSnapshot | null; labelOf: (host: string) => string }) {
  const accounts = useMemo<AccountUsage[]>(() => {
    if (!hub) return [];
    return accountUsage([
      { host: hub.host, label: labelOf(hub.host), subs: hub.subscriptions },
      ...hub.machines.map((m) => ({ host: m.host, label: m.label, stale: m.stale, subs: m.subscriptions })),
    ]);
  }, [hub, labelOf]);

  const shared = accounts.filter((a) => a.known && a.machines.length > 1).length;
  const unknown = accounts.filter((a) => !a.known).length;

  return (
    <Panel title="Accounts" right={<span className="font-mono text-[10px] text-ink-faint">{shared > 0 ? `${shared} shared by several machines` : "usage per login"}</span>}>
      <div className="flex flex-col gap-2 p-4">
        <p className="text-[11px] leading-4 text-ink-faint">
          One login used on several machines shares one set of limits. Each row adds those machines together. When one of them hits the limit,
          Run somewhere and project runs treat every machine on that login as limited until it resets.
        </p>
        {accounts.length === 0 && <p className="text-[11px] text-ink-faint">No subscriptions in use yet.</p>}
        {accounts.map((a) => (
          <AccountRow key={a.key} a={a} />
        ))}
        {unknown > 0 && (
          <p className="text-[10px] leading-4 text-ink-faint">
            Rows marked &quot;this machine only&quot; come from a machine that didn&apos;t say which login it uses (an older version, or no sign-in file), so they
            can&apos;t be combined yet.
          </p>
        )}
      </div>
    </Panel>
  );
}

function AccountRow({ a }: { a: AccountUsage }) {
  const accent: Accent = a.status === "limited" ? "rose" : a.status === "near" ? "amber" : "lime";
  const c = ACCENTS[accent];
  const pace = a.projectedFullAt ? `at this pace it fills in ${until(a.projectedFullAt)}${a.resetsAt ? `, ${until(a.resetsAt)} before the reset` : ""}` : null;
  return (
    <div className="rounded-xl border border-line px-3 py-2.5" title={a.note}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <SourcePill source={a.tool} label={a.tool === "codex" ? "ChatGPT" : a.tool} />
          <span className="truncate text-xs font-semibold text-ink">{a.label}</span>
          {a.plan && <span className="font-mono text-[10px] text-ink-faint">{a.plan}</span>}
        </span>
        <span className="font-mono text-[10px] text-ink-faint">
          {a.known ? `${a.machines.length} machine${a.machines.length === 1 ? "" : "s"}` : "this machine only"}
        </span>
      </div>

      {a.status === "limited" ? (
        <p className="pt-1.5 font-mono text-[11px]" style={{ color: c.base }}>
          Limit reached{a.observedOn ? ` (seen on ${a.observedOn})` : ""}
          {a.resetsAt ? ` · resets in ${until(a.resetsAt)}` : " · reset time not recorded"}
        </p>
      ) : a.usedPercent !== undefined ? (
        <>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full" style={{ background: "var(--color-line)" }}>
            <div className="h-full rounded-full" style={{ width: `${Math.min(100, a.usedPercent)}%`, background: c.base }} />
          </div>
          <p className="flex flex-wrap justify-between gap-x-3 pt-1 font-mono text-[10px] text-ink-faint">
            <span style={{ color: c.base }}>
              {a.usedPercent}% used{a.windowLabel ? ` · ${a.windowLabel}` : ""}
              {a.observedAt ? ` · seen ${ago(a.observedAt)} ago on ${a.observedOn}` : ""}
            </span>
            <span>{a.resetsAt ? `resets in ${until(a.resetsAt)}` : ""}</span>
          </p>
          {pace && (
            <p className="pt-0.5 font-mono text-[10px]" style={{ color: ACCENTS.amber.base }}>
              {pace}
            </p>
          )}
        </>
      ) : (
        <p className="pt-1.5 font-mono text-[10px] text-ink-faint">Limit not reported. {a.tool === "claude" ? "Claude Code only records the moment a limit is hit." : ""}</p>
      )}

      <div className="flex flex-wrap gap-x-3 gap-y-0.5 pt-1.5 font-mono text-[10px] text-ink-faint">
        <span className="text-ink-dim">
          {fmtTokens(a.tokens5h)} tokens · 5h &nbsp;·&nbsp; {fmtTokens(a.tokens7d)} · 7d
        </span>
        {a.machines.length > 1 &&
          a.machines
            .slice()
            .sort((x, y) => y.tokens7d - x.tokens7d)
            .map((m) => (
              <span key={m.host} style={m.stale ? { opacity: 0.5 } : undefined}>
                {m.label} {fmtTokens(m.tokens7d)}
              </span>
            ))}
      </div>
    </div>
  );
}
