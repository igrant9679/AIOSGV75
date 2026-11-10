"use client";

import Link from "next/link";
import { useProductName } from "../useNetSettings";
import { useCallback, useEffect, useState } from "react";
import Panel from "../ui/Panel";
import StatusOrb from "../ui/StatusOrb";
import { ACCENTS, type Accent } from "@/lib/accents";
import type { BridgeView } from "@/lib/bridge";
import { ago } from "./common";

const STATUS_TONE: Record<string, Accent> = {
  "awaiting-approval": "amber",
  running: "cyan",
  done: "lime",
  failed: "rose",
  rejected: "rose",
  expired: "violet",
};

function CopyBox({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <span className="panel-title">{label}</span>
      <div className="flex items-start gap-2 rounded-lg border border-line px-3 py-2">
        <span className="min-w-0 flex-1 break-words font-mono text-[11px] leading-4 text-ink">{text}</span>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              /* clipboard blocked - text is selectable */
            }
          }}
          className="shrink-0 cursor-pointer rounded-md border border-line px-2 py-0.5 font-mono text-[10px] text-ink-dim hover:bg-white/[0.06]"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

function Toggle({ on, label, hint, onClick, disabled }: { on: boolean; label: string; hint: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      title={hint}
      className="flex cursor-pointer items-start gap-2 rounded-xl border px-3 py-2 text-left transition-colors hover:bg-white/[0.04] disabled:opacity-50"
      style={{ borderColor: on ? ACCENTS.lime.border : "var(--color-line)" }}
    >
      <span className="pt-0.5">
        <StatusOrb accent={on ? "lime" : "cyan"} size={7} />
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-semibold text-ink">
          {label} <span className="font-mono text-[10px] font-normal text-ink-faint">{on ? "on" : "off"}</span>
        </span>
        <span className="block text-[10px] leading-4 text-ink-faint">{hint}</span>
      </span>
    </button>
  );
}

/**
 * Vault bridge for Claude Duet / OpenAI Dots: agents read Status.md and drop
 * tasks in Bridge/Inbox; the master runs them (after approval) and writes the
 * result to Bridge/Outbox.
 */
export default function BridgePanel() {
  const product = useProductName(); // this network's product name
  const [view, setView] = useState<BridgeView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (init?: RequestInit) => {
    try {
      const r = await fetch("/api/bridge", init);
      const b = (await r.json()) as BridgeView & { error?: string };
      if (r.ok) {
        setView(b);
        setError(null);
      } else setError(b.error ?? `HTTP ${r.status}`);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => load(), 30_000);
    return () => clearInterval(t);
  }, [load]);

  const post = async (body: object) => {
    setBusy(true);
    await load({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
  };

  if (!view) {
    return error ? (
      <Panel title="Bridge for Claude Duet & OpenAI Dots">
        <p className="p-4 text-[11px] text-ink-faint">Bridge unavailable: {error}</p>
      </Panel>
    ) : null;
  }

  const s = view.settings;
  const rel = view.folder.split(/[\\/]/).slice(-3).join("/"); // .../IdrisGV75/Agentic OS/Bridge
  const instruction = `Use the ${product} bridge in my OneDrive folder "${rel}". Read README.md there first. Check Status.md for what my AI tools are doing and what needs me. To hand ${product} a task, create a new .md file in its Inbox folder exactly as the README describes, then check Outbox for the result.`;
  const pending = view.tasks.filter((t) => t.status === "awaiting-approval").length;

  return (
    <Panel
      title="Bridge for Claude Duet & OpenAI Dots"
      right={
        <span className="flex items-center gap-2 font-mono text-[10px] text-ink-faint">
          <span>
            {view.statusUpdatedAt ? `Status.md written ${ago(view.statusUpdatedAt)} ago` : "Status.md not written yet"}
            {view.master ? ` · run by ${view.isMaster ? "this machine" : view.master}` : ""}
          </span>
          {view.isMaster && (
            <button type="button" onClick={() => post({ action: "run" })} disabled={busy} className="cursor-pointer rounded-md border border-line px-2 py-0.5 hover:bg-white/[0.06] disabled:opacity-50">
              {busy ? "Working…" : "Process now"}
            </button>
          )}
        </span>
      }
    >
      <div className="grid gap-4 p-4 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          <p className="text-[11px] leading-4 text-ink-dim">
            Cloud agents like <b>Claude Duet</b> and <b>OpenAI Dots</b> have no API, but they can read and write your OneDrive. {product} writes
            a status note for them there every 10 minutes, and runs the tasks they drop in its Inbox
            {s.requireApproval ? " after you approve them" : ""}, writing each result back to the Outbox. Give the agent your OneDrive / SharePoint
            connector, then tell it:
          </p>
          <CopyBox label="Tell Duet or your Dot" text={instruction} />
          <CopyBox label="Bridge folder on this machine" text={view.folder} />
        </div>
        <div className="flex flex-col gap-2">
          <Toggle on={s.enabled} label="Bridge" hint="Take tasks from the Inbox. Status.md is written either way." onClick={() => post({ action: "settings", enabled: !s.enabled })} disabled={busy} />
          <Toggle
            on={s.requireApproval}
            label="Ask me before running a task"
            hint="Each task waits for your approval (Command → Needs you, or Telegram). Turn off only if you trust everything that can write to your vault."
            onClick={() => post({ action: "settings", requireApproval: !s.requireApproval })}
            disabled={busy}
          />
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line px-3 py-2 text-[11px] text-ink-dim">
            <span>Up to</span>
            <select
              value={s.dailyLimit}
              onChange={(e) => post({ action: "settings", dailyLimit: Number(e.target.value) })}
              aria-label="Daily task limit"
              className="rounded-md border border-line bg-transparent px-1.5 py-0.5 font-mono text-[11px] text-ink"
            >
              {[5, 10, 20, 50].map((n) => (
                <option key={n} value={n} style={{ background: "var(--color-panel)" }}>
                  {n}
                </option>
              ))}
            </select>
            <span>tasks a day, run by</span>
            <select
              value={s.agent}
              onChange={(e) => post({ action: "settings", agent: e.target.value })}
              aria-label="Agent that runs bridge tasks"
              className="rounded-md border border-line bg-transparent px-1.5 py-0.5 font-mono text-[11px] text-ink"
            >
              <option value="claude" style={{ background: "var(--color-panel)" }}>Claude</option>
              <option value="auto" style={{ background: "var(--color-panel)" }}>Auto router</option>
            </select>
          </div>

          <p className="panel-title pt-1">
            Recent tasks{view.inboxWaiting ? ` · ${view.inboxWaiting} in the inbox` : ""}
            {pending ? (
              <>
                {" · "}
                <Link href="/" className="underline" style={{ color: ACCENTS.amber.base }}>
                  {pending} to approve
                </Link>
              </>
            ) : null}
          </p>
          {view.tasks.length === 0 && <p className="text-[11px] text-ink-faint">No tasks yet.</p>}
          {view.tasks.slice(0, 8).map((t) => {
            const tone = ACCENTS[STATUS_TONE[t.status] ?? "cyan"];
            return (
              <div key={t.file} className="flex items-center gap-2 border-b border-line py-1.5 last:border-b-0">
                <span className="rounded px-1.5 py-0.5 font-mono text-[9px] font-bold" style={{ background: tone.soft, color: tone.base }}>
                  {t.status.toUpperCase()}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-ink" title={t.file}>
                  {t.title}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-ink-faint">
                  {t.from ? `${t.from} · ` : ""}
                  {t.updated ? `${ago(t.updated)} ago` : ""}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </Panel>
  );
}
