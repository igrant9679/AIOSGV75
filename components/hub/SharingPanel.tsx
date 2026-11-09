"use client";

import { useCallback, useEffect, useState } from "react";
import Panel from "../ui/Panel";
import StatusOrb from "../ui/StatusOrb";
import { ACCENTS } from "@/lib/accents";
import { ago } from "./common";

interface SharingView {
  host: string;
  label: string;
  clusterOn: boolean;
  settings: { conversations: boolean; toolMemory: boolean; remoteReplies: "off" | "answer" | "edit" };
  last: { on: boolean; summaries: string; digests: number; memoryFiles: number; at: number } | null;
  remote: { host: string; label: string; publishedAt: number; sessions: number; acceptsReplies?: "off" | "answer" | "edit" }[];
  memory: { machine: string; claude: number; codex: number }[];
  error?: string;
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
 * What this machine shares with the rest of the machine group through the
 * vault, and what the other machines share back.
 */
export default function SharingPanel({ onShared }: { onShared?: () => void }) {
  const [view, setView] = useState<SharingView | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (init?: RequestInit) => {
    try {
      const r = await fetch("/api/hub/sharing", init);
      const b = (await r.json()) as SharingView;
      setView(r.ok ? b : (v) => (v ? { ...v, error: b.error } : v));
    } catch {
      /* keep last view */
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
    onShared?.();
  };

  if (!view) return null;

  if (!view.clusterOn) {
    return (
      <Panel title="Sharing across machines">
        <p className="p-4 text-[11px] leading-5 text-ink-faint">
          Turn on the machine group in Settings → Machines on each computer. Each one then shares its Claude Code and Codex sessions,
          conversations and tool memory through your vault, and every Mission Control shows them all.
        </p>
      </Panel>
    );
  }

  const memMine = view.memory.find((m) => m.machine === view.label);
  const lastLine = view.last
    ? view.last.summaries === "skipped"
      ? "waiting for this machine's session index to finish"
      : `last shared ${ago(view.last.at)} ago${view.last.digests ? ` · ${view.last.digests} conversations updated` : ""}${view.last.memoryFiles ? ` · ${view.last.memoryFiles} memory files updated` : ""}`
    : "not shared yet — runs every 5 minutes";

  return (
    <Panel
      title="Sharing across machines"
      right={
        <span className="flex items-center gap-2 font-mono text-[10px] text-ink-faint">
          <span>{lastLine}</span>
          <button type="button" onClick={() => post({ action: "run" })} disabled={busy} className="cursor-pointer rounded-md border border-line px-2 py-0.5 hover:bg-white/[0.06] disabled:opacity-50">
            {busy ? "Sharing…" : "Share now"}
          </button>
        </span>
      }
    >
      <div className="grid gap-4 p-4 lg:grid-cols-2">
        <div className="flex flex-col gap-2">
          <p className="panel-title">{view.label} shares</p>
          <Toggle on label="Session summaries" hint="Titles, projects, times, tokens and status of every Claude Code and Codex session, plus subscription meters. Always on while the machine group is on." onClick={() => {}} disabled />
          <Toggle
            on={view.settings.conversations}
            label="Conversations"
            hint="Your messages and the replies (no tool calls or output, secrets redacted) as notes in Agentic OS/Sessions — readable in Obsidian, found by vault search, usable as agent context."
            onClick={() => post({ action: "settings", conversations: !view.settings.conversations })}
            disabled={busy}
          />
          <Toggle
            on={view.settings.toolMemory}
            label="Tool memory"
            hint={`Read-only copies of Claude Code's CLAUDE.md and per-project memory, and Codex's AGENTS.md / memories, in Agentic OS/Tool Memory.${memMine ? ` Now: ${memMine.claude} Claude, ${memMine.codex} Codex files.` : ""}`}
            onClick={() => post({ action: "settings", toolMemory: !view.settings.toolMemory })}
            disabled={busy}
          />
          <div className="flex flex-col gap-1.5 rounded-xl border px-3 py-2" style={{ borderColor: view.settings.remoteReplies !== "off" ? ACCENTS.amber.border : "var(--color-line)" }}>
            <span className="text-xs font-semibold text-ink">Replies from my other machines</span>
            <span className="text-[10px] leading-4 text-ink-faint">
              Lets Mission Control on your other machines reply to {view.label}'s sessions, start new ones in its project folders, and read their full threads
              (Projects page). Requests travel through the vault, so anyone who can write to it could use this - leave it off unless you need it.
            </span>
            <span className="flex flex-wrap gap-1.5 pt-0.5">
              {(
                [
                  ["off", "Off"],
                  ["answer", "Answers only"],
                  ["edit", "Answers + file edits"],
                ] as const
              ).map(([v, label]) => {
                const on = view.settings.remoteReplies === v;
                return (
                  <button
                    key={v}
                    type="button"
                    disabled={busy}
                    aria-pressed={on}
                    onClick={() => post({ action: "settings", remoteReplies: v })}
                    className="cursor-pointer rounded-md border px-2 py-0.5 font-mono text-[10px] transition-colors hover:bg-white/[0.06] disabled:opacity-50"
                    style={on ? { borderColor: ACCENTS.amber.border, color: ACCENTS.amber.base } : { borderColor: "var(--color-line)", color: "var(--color-ink-dim)" }}
                  >
                    {label}
                  </button>
                );
              })}
            </span>
          </div>
          <p className="text-[10px] leading-4 text-ink-faint">
            Already shared by the vault itself: Memory.md, your profile, journal, goals and Mission Control chat logs.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <p className="panel-title">Other machines share</p>
          {view.remote.length === 0 && (
            <p className="text-[11px] leading-4 text-ink-faint">
              Nothing yet. Update Mission Control on your other machines (run update.cmd there) — they start sharing within 5 minutes.
            </p>
          )}
          {view.remote.map((r) => {
            const mem = view.memory.find((m) => m.machine === r.label);
            const fresh = Date.now() - r.publishedAt < 2 * 60 * 60_000;
            return (
              <div key={r.host} className="flex items-center gap-2 rounded-xl border border-line px-3 py-2">
                <StatusOrb accent={fresh ? "lime" : "amber"} size={7} />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-semibold text-ink">{r.label}</span>
                  <span className="block font-mono text-[10px] text-ink-faint">
                    {r.sessions} sessions · published {ago(r.publishedAt)} ago{mem ? ` · ${mem.claude + mem.codex} memory files` : ""} · replies{" "}
                    {r.acceptsReplies === "edit" ? "with edits" : r.acceptsReplies === "answer" ? "answers only" : "off"}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </Panel>
  );
}
