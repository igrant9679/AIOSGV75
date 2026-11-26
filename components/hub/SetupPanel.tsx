"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Panel from "../ui/Panel";
import { ACCENTS, type Accent } from "@/lib/accents";
import { ago } from "./common";

interface SetupMcp {
  name: string;
  source: "user" | "plugin" | "mission-control";
  plugin?: string;
  kind: string;
  command?: string;
  enabled: boolean;
  parked?: boolean;
}
interface SetupPlugin {
  id: string;
  version?: string;
  enabled: boolean;
  mcp: string[];
  skills: string[];
}
interface Machine {
  host: string;
  label: string;
  at: number;
  self: boolean;
  acceptsReplies: string;
  clis: { name: string; version?: string }[];
  mcp: SetupMcp[];
  skills: string[];
  plugins: SetupPlugin[];
  hooks: Record<string, number>;
  claudeMd?: { bytes: number; hash: string };
  codexAgentsMd?: { bytes: number; hash: string };
}
interface ChangeJob {
  id: string;
  host: string;
  hostLabel: string;
  action?: string;
  target?: string;
  status: string;
  reply?: string;
  error?: string;
  createdAt: number;
  finishedAt?: number;
}
interface SetupView {
  machines: Machine[];
  jobs: ChangeJob[];
  error?: string;
}

type Pending = { host: string; label: string; change: "mcp-off" | "mcp-on" | "plugin-off" | "plugin-on"; target: string; what: string };

const short = (id: string) => id.split("@")[0];

/** "1.2.10" > "1.2.9": compares the numeric parts. */
function newer(a: string, b: string): boolean {
  const pa = a.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return false;
}

function Chip({ accent, dim, title, onClick, children }: { accent?: Accent; dim?: boolean; title?: string; onClick?: () => void; children: React.ReactNode }) {
  const style = accent ? { borderColor: ACCENTS[accent].border, color: ACCENTS[accent].base } : { borderColor: "var(--color-line)", color: dim ? "var(--color-ink-faint)" : "var(--color-ink-dim)" };
  return onClick ? (
    <button type="button" title={title} onClick={onClick} className="cursor-pointer rounded-md border px-1.5 py-0.5 font-mono text-[10px] transition-colors hover:bg-white/[0.06]" style={style}>
      {children}
    </button>
  ) : (
    <span title={title} className="rounded-md border px-1.5 py-0.5 font-mono text-[10px]" style={style}>
      {children}
    </span>
  );
}

/**
 * Fleet → Setup: each machine's AI tools side by side (CLI versions, MCP servers, plugins, skills,
 * hooks, CLAUDE.md), what differs between them, and MCP servers / plugins turned off or on per
 * machine (lib/machineSetup.ts). Every change is confirmed here first.
 */
export default function SetupPanel() {
  const [view, setView] = useState<SetupView | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (init?: RequestInit) => {
    try {
      const r = await fetch("/api/hub/setup", init);
      const b = (await r.json()) as SetupView;
      if (b.machines) setView(b);
      setErr(r.ok ? null : (b.error ?? `HTTP ${r.status}`));
    } catch {
      /* keep the last view */
    }
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(() => load(), 120_000);
    return () => clearInterval(t);
  }, [load]);

  const post = async (body: object) => {
    setBusy(true);
    await load({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
  };

  // what differs: newest CLI versions, skills others have, the usual CLAUDE.md
  const fleet = useMemo(() => {
    const ms = view?.machines ?? [];
    const newest = new Map<string, string>();
    for (const m of ms) for (const c of m.clis) if (c.version && (!newest.has(c.name) || newer(c.version, newest.get(c.name)!))) newest.set(c.name, c.version);
    const allSkills = new Set(ms.flatMap((m) => m.skills));
    const mdCount = new Map<string, number>();
    for (const m of ms) if (m.claudeMd) mdCount.set(m.claudeMd.hash, (mdCount.get(m.claudeMd.hash) ?? 0) + 1);
    const usualMd = [...mdCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    return { newest, allSkills, usualMd };
  }, [view]);

  if (!view) return null;

  const ask = (m: Machine, change: Pending["change"], target: string, what: string) => {
    if (!m.self && m.acceptsReplies !== "edit") return;
    setPending({ host: m.host, label: m.label, change, target, what });
  };

  return (
    <Panel
      title="Setup"
      right={
        <span className="flex items-center gap-2 font-mono text-[10px] text-ink-faint">
          <span>MCP servers, plugins, skills and CLI versions per machine</span>
          <button type="button" onClick={() => post({ action: "refresh" })} disabled={busy} className="cursor-pointer rounded-md border border-line px-2 py-0.5 hover:bg-white/[0.06] disabled:opacity-50">
            {busy ? "Reading…" : "Re-read this machine"}
          </button>
        </span>
      }
    >
      <div className="flex flex-col gap-2 p-4">
        {err && (
          <p className="text-[11px]" style={{ color: ACCENTS.rose.base }}>
            {err}
          </p>
        )}
        {pending && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2" style={{ borderColor: ACCENTS.amber.border }}>
            <span className="min-w-0 flex-1 text-xs text-ink">
              {pending.what} on <b>{pending.label}</b>? New Claude sessions there get the change; sessions already open keep what they started with.
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                const p = pending;
                setPending(null);
                await post({ action: "change", host: p.host, change: p.change, target: p.target });
              }}
              className="cursor-pointer rounded-md px-2.5 py-1 text-[11px] font-bold text-black disabled:opacity-50"
              style={{ background: ACCENTS.amber.base }}
            >
              {pending.change.endsWith("-off") ? "Turn off" : "Turn on"}
            </button>
            <button type="button" onClick={() => setPending(null)} className="cursor-pointer rounded-md border border-line px-2.5 py-1 text-[11px] text-ink-dim hover:bg-white/[0.06]">
              Cancel
            </button>
          </div>
        )}
        {view.machines.map((m) => {
          const canChange = m.self || m.acceptsReplies === "edit";
          const missing = [...fleet.allSkills].filter((s) => !m.skills.includes(s)).sort();
          const only = m.skills.filter((s) => view.machines.every((o) => o.host === m.host || !o.skills.includes(s)));
          const mdDiffers = m.claudeMd && fleet.usualMd && m.claudeMd.hash !== fleet.usualMd && view.machines.length > 1;
          const lockTitle = canChange ? undefined : `${m.label} allows answers only from other machines. To change its setup from here, set its Replies from my other machines to "Answers + file edits" (Fleet → Sharing on that machine).`;
          return (
            <div key={m.host} className="flex flex-col gap-1.5 rounded-xl border border-line px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-ink">{m.label}</span>
                {m.self && <span className="font-mono text-[10px] text-ink-faint">this machine</span>}
                <span className="font-mono text-[10px] text-ink-faint">as of {ago(m.at)} ago</span>
                {!canChange && (
                  <span className="font-mono text-[10px] text-ink-faint" title={lockTitle}>
                    · view only (answers-only machine)
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <span className="w-16 shrink-0 text-[10px] text-ink-faint">Tools</span>
                {m.clis.map((c) => {
                  const behind = c.version && fleet.newest.get(c.name) && newer(fleet.newest.get(c.name)!, c.version);
                  return (
                    <Chip key={c.name} accent={behind ? "amber" : undefined} dim={!c.version} title={behind ? `Newest in the fleet: ${fleet.newest.get(c.name)}` : undefined}>
                      {c.name} {c.version ?? "—"}
                    </Chip>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <span className="w-16 shrink-0 text-[10px] text-ink-faint">MCP</span>
                {m.mcp.length === 0 && <span className="font-mono text-[10px] text-ink-faint">none</span>}
                {m.mcp.map((s) => {
                  const fromPlugin = s.source === "plugin";
                  const title = `${s.name}: ${s.kind}${s.command ? ` · ${s.command}` : ""}${fromPlugin ? ` · comes with plugin ${s.plugin}` : s.source === "mission-control" ? " · Mission Control's own (Settings)" : " · your own (~/.claude.json)"}${s.parked ? " · turned off from here" : ""}${lockTitle ? `\n${lockTitle}` : canChange && s.source !== "mission-control" ? "\nClick to turn it " + (s.enabled ? "off" : "on") : ""}`;
                  const click =
                    !canChange || s.source === "mission-control"
                      ? undefined
                      : fromPlugin
                        ? () => ask(m, s.enabled ? "plugin-off" : "plugin-on", s.plugin!, `Turn ${s.enabled ? "off" : "on"} the plugin ${short(s.plugin!)} (it brings ${s.name})`)
                        : () => ask(m, s.enabled ? "mcp-off" : "mcp-on", s.name, `Turn ${s.enabled ? "off" : "on"} the MCP server ${s.name}`);
                  return (
                    <Chip key={`${s.source}:${s.plugin ?? ""}:${s.name}`} accent={s.enabled ? "lime" : undefined} dim={!s.enabled} title={title} onClick={click}>
                      {s.enabled ? "●" : "○"} {s.name}
                      {fromPlugin ? ` (${short(s.plugin!)})` : ""}
                    </Chip>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <span className="w-16 shrink-0 text-[10px] text-ink-faint">Plugins</span>
                {m.plugins.length === 0 && <span className="font-mono text-[10px] text-ink-faint">none</span>}
                {m.plugins.map((p) => (
                  <Chip
                    key={p.id}
                    accent={p.enabled ? "lime" : undefined}
                    dim={!p.enabled}
                    title={`${p.id}${p.version ? ` ${p.version}` : ""}${p.mcp.length ? ` · MCP: ${p.mcp.join(", ")}` : ""}${p.skills.length ? ` · skills: ${p.skills.join(", ")}` : ""}${lockTitle ? `\n${lockTitle}` : `\nClick to turn it ${p.enabled ? "off" : "on"}`}`}
                    onClick={canChange ? () => ask(m, p.enabled ? "plugin-off" : "plugin-on", p.id, `Turn ${p.enabled ? "off" : "on"} the plugin ${short(p.id)}${p.mcp.length || p.skills.length ? ` (${[p.mcp.length ? `MCP ${p.mcp.join(", ")}` : "", p.skills.length ? `${p.skills.length} skills` : ""].filter(Boolean).join(", ")})` : ""}`) : undefined}
                  >
                    {p.enabled ? "●" : "○"} {short(p.id)}
                  </Chip>
                ))}
              </div>
              <div className="flex flex-wrap items-baseline gap-1 text-[10px] leading-4">
                <span className="w-16 shrink-0 text-ink-faint">Skills</span>
                <span className="font-mono text-ink-dim">{m.skills.length}</span>
                {missing.length > 0 && (
                  <span className="font-mono" style={{ color: ACCENTS.amber.base }} title={missing.join(", ")}>
                    · missing {missing.length} the others have: {missing.slice(0, 6).join(", ")}
                    {missing.length > 6 ? "…" : ""}
                  </span>
                )}
                {only.length > 0 && view.machines.length > 1 && (
                  <span className="font-mono text-ink-faint" title={only.join(", ")}>
                    · only here: {only.slice(0, 6).join(", ")}
                    {only.length > 6 ? "…" : ""}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-baseline gap-1 font-mono text-[10px] leading-4 text-ink-faint">
                <span className="w-16 shrink-0 font-sans">Other</span>
                <span>hooks: {Object.keys(m.hooks).length ? Object.entries(m.hooks).map(([k, n]) => `${k}${n > 1 ? ` ×${n}` : ""}`).join(", ") : "none"}</span>
                <span>
                  · CLAUDE.md:{" "}
                  {m.claudeMd ? (
                    <span style={mdDiffers ? { color: ACCENTS.amber.base } : undefined}>
                      {(m.claudeMd.bytes / 1024).toFixed(1)} KB{mdDiffers ? " (differs from most machines)" : ""}
                    </span>
                  ) : (
                    "none"
                  )}
                </span>
                {m.codexAgentsMd && <span>· Codex AGENTS.md {(m.codexAgentsMd.bytes / 1024).toFixed(1)} KB</span>}
              </div>
            </div>
          );
        })}
        {view.jobs.length > 0 && (
          <div className="flex flex-col gap-0.5 pt-1">
            <p className="panel-title">Recent changes</p>
            {view.jobs.slice(0, 6).map((j) => (
              <p key={j.id} className="font-mono text-[10px] leading-4">
                <span style={{ color: j.status === "done" ? ACCENTS.lime.base : j.status === "error" || j.status === "expired" ? ACCENTS.rose.base : ACCENTS.cyan.base }}>
                  {j.status}
                </span>{" "}
                <span className="text-ink-dim">
                  {j.hostLabel}: {j.action} {j.target}
                </span>{" "}
                <span className="text-ink-faint">
                  · {j.reply ?? j.error ?? ""} · {ago(j.finishedAt ?? j.createdAt)} ago
                </span>
              </p>
            ))}
          </div>
        )}
        <p className="text-[10px] leading-4 text-ink-faint">
          Each machine shares names and versions only, every 15 minutes (never an MCP server&apos;s settings or keys). A machine on an older version
          isn&apos;t listed until it is updated. Turning off one of your own MCP servers keeps its settings on that machine, so turning it back on restores it
          exactly; a server that comes with a plugin is turned off with its plugin.
        </p>
      </div>
    </Panel>
  );
}
