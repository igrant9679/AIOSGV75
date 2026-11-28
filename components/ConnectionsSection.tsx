"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

/** /connections (rule 51): every sign-in, model, service and subscription in one place. */

type Any = any;
interface Sub { id: string; name: string; plan?: string; tool?: string; monthly: number; renewDay?: number; note?: string }
const TOOL: Record<string, string> = { claude: "Claude", codex: "ChatGPT / Codex", gemini: "Gemini", hermes: "Hermes", kimi: "Kimi", other: "Other" };
const field = "rounded-lg border border-line bg-transparent px-2.5 py-1.5 text-[13px] text-ink outline-none";
const ghost = "cursor-pointer rounded-lg border border-line px-3 py-1.5 text-[12px] text-ink-dim";
const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const until = (day: number) => {
  const now = new Date(), y = now.getFullYear(), m = now.getMonth();
  const last = (yy: number, mm: number) => new Date(yy, mm + 1, 0).getDate();
  const today = new Date(y, m, now.getDate()).getTime();
  let d = new Date(y, m, Math.min(day, last(y, m)));
  if (d.getTime() < today) d = new Date(y, m + 1, Math.min(day, last(y, m + 1)));
  return { days: Math.round((d.getTime() - today) / 86400e3), date: d };
};
const dot = (ok: boolean | "warn") => <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: ok === "warn" ? "var(--ac-amber)" : ok ? "var(--ac-lime)" : "var(--color-ink-faint)" }} />;

export default function ConnectionsSection() {
  const [v, setV] = useState<Any | null>(null);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [draft, setDraft] = useState<Partial<Sub> | null>(null);
  const [checking, setChecking] = useState(false);
  const load = useCallback(async () => {
    setChecking(true);
    try {
      const j = await (await fetch("/api/connections")).json();
      if (j.error) setMsg({ text: j.error, bad: true });
      else setV(j);
    } catch (e) {
      setMsg({ text: (e as Error).message, bad: true });
    }
    setChecking(false);
  }, []);
  useEffect(() => void load(), [load]);
  const post = async (body: object, ok: string) => {
    const r = await (await fetch("/api/connections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
    setMsg(r.error ? { text: r.error, bad: true } : { text: ok });
    if (r.subscriptions) setV((x: Any) => ({ ...x, subscriptions: r.subscriptions }));
    return !r.error;
  };
  if (!v) return <p className="text-[13px] text-ink-faint">{msg?.text ?? "Checking every connection…"}</p>;
  const subs: Sub[] = v.subscriptions ?? [];
  const total = subs.reduce((a, s) => a + s.monthly, 0);
  const renewals = subs.filter((s) => s.renewDay).map((s) => ({ s, ...until(s.renewDay!) })).sort((a, b) => a.days - b.days);
  const usage = (tool?: string) => {
    const t = (v.signins ?? []).find((x: Any) => x.tool === tool);
    const ms = (t?.machines ?? []).filter((m: Any) => m.status !== "not_set_up");
    if (!ms.length) return null;
    const limited = ms.filter((m: Any) => m.status === "limited");
    const top = Math.max(...ms.map((m: Any) => m.usedPercent ?? 0));
    return { text: limited.length ? `at its limit on ${limited.map((m: Any) => m.machine).join(", ")}` : top ? `${top}% of the plan used` : `signed in on ${ms.length} machine${ms.length === 1 ? "" : "s"}`, bad: limited.length > 0 };
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <p className="text-[12px] text-ink-faint">Your AI tools run on their subscriptions, signed in on each machine. Keys are only for extra models and services, and their values never leave the machine that holds them.{v.notReached?.length ? ` Couldn't reach: ${v.notReached.join(", ")}.` : ""}</p>
        <span className="flex-1" />
        <button type="button" className={ghost} onClick={() => void load()} disabled={checking}>{checking ? "Checking…" : "Check all"}</button>
      </div>
      {msg && <p className="text-[12px]" style={{ color: msg.bad ? "var(--ac-rose)" : "var(--ac-lime)" }}>{msg.text}</p>}

      <div className="panel p-4">
        <div className="flex items-baseline justify-between pb-2">
          <p className="text-[14px] font-semibold text-ink">AI sign-ins, by machine</p>
          <Link href="/fleet" className="text-[12px] text-ink-faint underline">Manage in Fleet</Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12px]">
            <thead>
              <tr className="text-ink-faint">
                <th className="py-1.5 pr-3 font-medium">Tool</th>
                {(v.signins[0]?.machines ?? []).map((m: Any) => (
                  <th key={m.machine} className="px-2 py-1.5 font-medium">{m.machine}{m.online ? "" : " (off)"}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {v.signins.map((t: Any) => (
                <tr key={t.tool} className="border-t border-line">
                  <td className="py-2 pr-3 font-semibold text-ink">{TOOL[t.tool] ?? t.tool}</td>
                  {t.machines.map((m: Any) => (
                    <td key={m.machine} className="px-2 py-2 text-ink-dim" title={m.note}>
                      <span className="flex items-center gap-1.5">
                        {dot(m.status === "limited" || m.status === "near" ? "warn" : m.status !== "not_set_up" && m.status !== "unknown")}
                        {m.status === "not_set_up" ? "not signed in" : m.status === "limited" ? "at its limit" : m.status === "near" ? "near its limit" : m.status === "unknown" ? "signed in" : "ready"}
                        {m.usedPercent != null ? ` · ${m.usedPercent}%` : ""}
                      </span>
                      {m.plan && <span className="block pl-3.5 text-[11px] text-ink-faint">{m.plan}</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="panel flex flex-col p-4">
          <p className="pb-1 text-[14px] font-semibold text-ink">Services</p>
          {v.services.map((s: Any) => (
            <div key={s.id} className="flex items-center gap-3 border-t border-line py-2.5 first:border-t-0">
              {dot(s.ok)}
              <span className="min-w-0 flex-1">
                <b className="block text-[13px] text-ink">{s.name}</b>
                <span className="block text-[12px] text-ink-dim">{s.detail}</span>
              </span>
              <Link href={s.manage} className={ghost}>{s.ok ? "Manage" : "Connect"}</Link>
            </div>
          ))}
        </div>
        <div className="panel flex flex-col p-4">
          <div className="flex items-baseline justify-between pb-1">
            <p className="text-[14px] font-semibold text-ink">Models added by key, and local models</p>
            <Link href="/settings" className="text-[12px] text-ink-faint underline">Manage in Settings</Link>
          </div>
          {v.models.length === 0 && <p className="py-2 text-[12px] text-ink-faint">None. Your subscriptions do the work.</p>}
          {v.models.map((m: Any) => (
            <div key={m.id} className="flex items-center gap-3 border-t border-line py-2.5 first:border-t-0">
              {dot(m.ready)}
              <span className="min-w-0 flex-1">
                <b className="block text-[13px] text-ink">{m.name}</b>
                <span className="block text-[12px] text-ink-dim">{m.provider} · {m.model} · {m.local ? "runs on this machine, free" : m.ready ? "key saved (billed by its provider)" : "no key"}{m.autoRoute ? " · Auto may use it" : ""}</span>
              </span>
            </div>
          ))}
          {v.machines.filter((m: Any) => m.localModel).length > 0 && <p className="border-t border-line pt-2 text-[12px] text-ink-faint">Local models lent to runs: {v.machines.filter((m: Any) => m.localModel).map((m: Any) => `${m.label} (${m.localModel})`).join(", ")}</p>}
        </div>
      </div>

      <div className="panel flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-[14px] font-semibold text-ink">Subscriptions</p>
          <span className="text-[12px] text-ink-faint">What each plan costs and when it renews, next to how much of it you are using.</span>
          <span className="flex-1" />
          <button type="button" className="cursor-pointer rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white" style={{ background: "var(--ac-violet)" }} onClick={() => setDraft({ name: "", monthly: 20, tool: "claude" })}>+ Add subscription</button>
        </div>
        <div className="grid gap-3 md:grid-cols-[1fr_1fr]">
          <div className="rounded-xl border border-line p-3">
            <p className="text-[12px] text-ink-faint">Total a month</p>
            <p className="text-2xl font-bold text-ink">{money(total)}</p>
            <p className="text-[12px] text-ink-faint">{money(total * 12)} a year across {subs.length} subscription{subs.length === 1 ? "" : "s"}</p>
            {subs.length > 0 && (
              <div className="mt-3 flex h-20 items-end gap-2">
                {subs.map((s) => (
                  <div key={s.id} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={`${s.name}: ${money(s.monthly)}`}>
                    <div className="w-full rounded-t" style={{ height: `${Math.max(4, (s.monthly / Math.max(...subs.map((x) => x.monthly), 1)) * 60)}px`, background: "var(--ac-violet)" }} />
                    <span className="w-full truncate text-center text-[10px] text-ink-faint">{s.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="rounded-xl border border-line p-3">
            <p className="pb-1 text-[13px] font-semibold text-ink">Next renewals</p>
            {renewals.length === 0 && <p className="text-[12px] text-ink-faint">Add a renewal day to see what is coming.</p>}
            {renewals.slice(0, 4).map(({ s, days, date }) => (
              <p key={s.id} className="flex items-center justify-between border-t border-line py-1.5 text-[12px] text-ink first:border-t-0">
                <span><b>{s.name}</b> <span className="text-ink-faint">{date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })} · {money(s.monthly)}</span></span>
                <span className="text-ink-faint">{days === 0 ? "today" : `in ${days} day${days === 1 ? "" : "s"}`}</span>
              </p>
            ))}
          </div>
        </div>
        {draft && (
          <div className="flex flex-wrap items-end gap-2 rounded-xl border border-line p-3">
            <label className="flex flex-col gap-1 text-[11px] text-ink-faint">Name<input value={draft.name ?? ""} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Claude Max" className={`${field} w-40`} /></label>
            <label className="flex flex-col gap-1 text-[11px] text-ink-faint">Plan<input value={draft.plan ?? ""} onChange={(e) => setDraft({ ...draft, plan: e.target.value })} placeholder="Max 20x" className={`${field} w-28`} /></label>
            <label className="flex flex-col gap-1 text-[11px] text-ink-faint">Feeds
              <select value={draft.tool ?? "other"} onChange={(e) => setDraft({ ...draft, tool: e.target.value })} className={field}>
                {Object.entries(TOOL).map(([k, l]) => <option key={k} value={k} style={{ background: "var(--color-panel)" }}>{l}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-ink-faint">A month ($)<input type="number" min={0} step="0.01" value={draft.monthly ?? 0} onChange={(e) => setDraft({ ...draft, monthly: Number(e.target.value) })} className={`${field} w-24`} /></label>
            <label className="flex flex-col gap-1 text-[11px] text-ink-faint">Renews on day<input type="number" min={1} max={31} value={draft.renewDay ?? ""} onChange={(e) => setDraft({ ...draft, renewDay: e.target.value ? Number(e.target.value) : undefined })} placeholder="11" className={`${field} w-20`} /></label>
            <button type="button" className="cursor-pointer rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white" style={{ background: "var(--ac-violet)" }} onClick={async () => { if (await post({ action: "sub-save", subscription: draft }, "Saved.")) setDraft(null); }}>Save</button>
            <button type="button" className={ghost} onClick={() => setDraft(null)}>Cancel</button>
          </div>
        )}
        {subs.length > 0 && (
          <table className="w-full text-left text-[12px]">
            <thead><tr className="text-ink-faint"><th className="py-1.5 font-medium">Subscription</th><th className="font-medium">Feeds</th><th className="font-medium">A month</th><th className="font-medium">Renews</th><th className="font-medium">Right now</th><th /></tr></thead>
            <tbody>
              {subs.map((s) => {
                const u = usage(s.tool);
                const r = s.renewDay ? until(s.renewDay) : null;
                return (
                  <tr key={s.id} className="border-t border-line">
                    <td className="py-2 text-ink"><b>{s.name}</b>{s.plan ? <span className="block text-[11px] text-ink-faint">{s.plan}</span> : null}</td>
                    <td className="text-ink-dim">{TOOL[s.tool ?? "other"] ?? "Other"}</td>
                    <td className="text-ink">{money(s.monthly)}</td>
                    <td className="text-ink-dim">{r ? `${r.date.toLocaleDateString(undefined, { day: "numeric", month: "short" })} · in ${r.days} d` : "—"}</td>
                    <td style={{ color: u?.bad ? "var(--ac-amber)" : "var(--color-ink-dim)" }}>{u?.text ?? "—"}</td>
                    <td className="text-right">
                      <button type="button" className="mr-2 cursor-pointer text-ink-faint underline" onClick={() => setDraft({ ...s })}>edit</button>
                      <button type="button" className="cursor-pointer underline" style={{ color: "var(--ac-rose)" }} onClick={() => confirm(`Remove ${s.name}?`) && void post({ action: "sub-delete", id: s.id }, "Removed.")}>remove</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
