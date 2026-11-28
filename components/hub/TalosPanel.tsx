"use client";

import { useCallback, useEffect, useState } from "react";
import Panel from "../ui/Panel";
import { ACCENTS } from "@/lib/accents";
import { SmallButton } from "./SessionPanel";
import { ago } from "./common";

/** Fleet → Talos: control the fleet from Telegram (rule 47) — try a question, notifications, digest, failover, recent actions. */

type Settings = {
  notify: boolean;
  quietFrom: string;
  quietTo: string;
  digest: boolean;
  digestAt: string;
  events: Record<"results" | "failures" | "permissions" | "levelup" | "offline" | "limits", boolean>;
  failover: { enabled: boolean; primaryHost: string; minutes: number };
};
type Card = { id: string; createdAt: number; method: string; path: string; hostLabel: string; summary: string; status: string; error?: string };

const EVENT_LABEL: Record<keyof Settings["events"], string> = { results: "results ready to review", failures: "jobs that didn't finish", permissions: "AI asking permission", levelup: "LevelUp hand-offs to approve", offline: "a machine offline 10+ min", limits: "a plan hitting its limit" };
const field = "rounded-md border border-line bg-transparent px-2 py-1 font-mono text-[11px] text-ink outline-none";

export default function TalosPanel() {
  const [s, setS] = useState<Settings | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(() => {
    fetch("/api/talos?what=settings").then((r) => r.json()).then((j) => j.settings && setS(j.settings)).catch(() => {});
    fetch("/api/talos?what=cards").then((r) => r.json()).then((j) => setCards(j.cards ?? [])).catch(() => {});
  }, []);
  useEffect(() => load(), [load]);
  const save = async (patch: Partial<Settings> | Record<string, unknown>) => {
    const r = await (await fetch("/api/talos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "settings", ...patch }) })).json();
    if (r.settings) setS(r.settings);
    setMsg(r.error ?? "Saved.");
  };
  const ask = async () => {
    if (!q.trim()) return;
    setBusy(true);
    setAnswer(null);
    try {
      const r = await (await fetch("/api/talos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "ask", question: q }) })).json();
      setAnswer(r.answer ?? `Couldn't answer: ${r.error}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel title="Talos · control from Telegram">
      <div className="flex flex-col gap-3 p-4">
        <p className="text-[11px] leading-4 text-ink-faint">
          Talos (OpenClaw on Telegram) can read anything in Mission Control on any machine and run any change you say yes to in Telegram. It asks Mission Control through one door (/api/talos): a picture of the whole fleet, every endpoint&apos;s manual, and confirm cards that run once, expire after 10 minutes and are logged in Remote actions. A change on another machine runs only where that machine allows edits from your other machines.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void ask()} placeholder="Try what Talos will answer, e.g. how many open tasks across how many machines?" aria-label="Ask about the fleet" className={`${field} min-w-0 flex-1`} />
          <SmallButton accent onClick={() => void ask()} disabled={busy}>
            {busy ? "Asking…" : "Ask"}
          </SmallButton>
        </div>
        {answer && <p className="whitespace-pre-wrap rounded-md border border-line px-3 py-2 text-[12px] text-ink">{answer}</p>}
        {s && (
          <div className="grid gap-3 md:grid-cols-2">
            <div className="flex flex-col gap-1.5 rounded-lg border border-line p-3 font-mono text-[10px] text-ink-dim">
              <p className="text-[12px] font-semibold text-ink">Telegram notifications</p>
              <label className="flex cursor-pointer items-center gap-1">
                <input type="checkbox" checked={s.notify} onChange={(e) => void save({ notify: e.target.checked })} /> tell me as things happen
              </label>
              {(Object.keys(EVENT_LABEL) as (keyof Settings["events"])[]).map((k) => (
                <label key={k} className="ml-4 flex cursor-pointer items-center gap-1">
                  <input type="checkbox" checked={s.events[k]} disabled={!s.notify} onChange={(e) => void save({ events: { [k]: e.target.checked } })} /> {EVENT_LABEL[k]}
                </label>
              ))}
              <label className="flex items-center gap-1">
                quiet from <input type="time" value={s.quietFrom} onChange={(e) => void save({ quietFrom: e.target.value })} className={field} /> to <input type="time" value={s.quietTo} onChange={(e) => void save({ quietTo: e.target.value })} className={field} /> (held for the digest)
              </label>
              <label className="flex cursor-pointer items-center gap-1">
                <input type="checkbox" checked={s.digest} onChange={(e) => void save({ digest: e.target.checked })} /> morning digest at <input type="time" value={s.digestAt} onChange={(e) => void save({ digestAt: e.target.value })} className={field} />
              </label>
              <p className="text-ink-faint">Sent by the master machine (it holds the bot). Approvals and health problems are already sent as before.</p>
            </div>
            <div className="flex flex-col gap-1.5 rounded-lg border border-line p-3 font-mono text-[10px] text-ink-dim">
              <p className="text-[12px] font-semibold text-ink">Telegram failover (this machine)</p>
              <p className="text-ink-faint">Only one machine may poll the bot. With this on, THIS machine starts its OpenClaw gateway when the primary has been quiet for the minutes below, and stops it as soon as the primary is back.</p>
              <label className="flex items-center gap-1">
                primary <input defaultValue={s.failover.primaryHost} key={s.failover.primaryHost} onBlur={(e) => e.target.value !== s.failover.primaryHost && void save({ failover: { primaryHost: e.target.value.trim() } })} placeholder="e.g. IdrisLegion7" className={`${field} w-40`} />
                after <input type="number" min={3} max={60} defaultValue={s.failover.minutes} key={`m${s.failover.minutes}`} onBlur={(e) => void save({ failover: { minutes: Number(e.target.value) } })} className={`${field} w-14`} /> min
              </label>
              <label className="flex cursor-pointer items-center gap-1">
                <input type="checkbox" checked={s.failover.enabled} disabled={!s.failover.primaryHost} onChange={(e) => void save({ failover: { enabled: e.target.checked } })} /> take over Telegram here when the primary is down
              </label>
              <p style={{ color: ACCENTS.amber.base }}>Prepare this machine first: OpenClaw with the same Telegram channel added, its gateway stopped and its auto-start task off. Otherwise it would poll all the time.</p>
            </div>
          </div>
        )}
        {msg && <p className="font-mono text-[10px]" style={{ color: ACCENTS.lime.base }}>{msg}</p>}
        <div className="flex flex-col">
          <p className="font-mono text-[10px] text-ink-dim">Recent changes asked through Talos</p>
          {cards.length === 0 && <p className="font-mono text-[10px] text-ink-faint">None yet.</p>}
          {cards.slice(0, 12).map((c) => (
            <p key={c.id} className="border-t border-line py-1 font-mono text-[10px] text-ink-faint first:border-t-0">
              <span style={{ color: c.status === "done" ? ACCENTS.lime.base : c.status === "failed" ? ACCENTS.rose.base : c.status === "waiting" ? ACCENTS.amber.base : undefined }}>{c.status}</span> · {ago(c.createdAt)} ago · {c.hostLabel} · {c.summary} <span className="text-ink-faint">({c.method} {c.path})</span>
              {c.error ? ` — ${c.error}` : ""}
            </p>
          ))}
        </div>
      </div>
    </Panel>
  );
}
