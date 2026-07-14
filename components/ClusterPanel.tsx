"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import Panel from "./ui/Panel";
import StatusOrb from "./ui/StatusOrb";
import { IconCheck, IconTrash } from "./icons";
import { useMission } from "./store";

type Role = "primary" | "backup" | "workstation";
interface NodeView {
  host: string;
  role: Role;
  installDir: string;
  label: string;
  platform: string;
  ts: number;
  isMaster: boolean;
  online: boolean;
  self: boolean;
}
interface Status {
  self: string;
  config: { enabled: boolean; role: Role; installDir: string; label: string };
  master: string | null;
  masterIsSelf: boolean;
  leaseExpiresAt: number;
  vaultOk: boolean;
  nodes: NodeView[];
}

const inputCls =
  "w-full rounded-lg border border-line bg-panel-2 px-3 py-2 font-mono text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-line-bright";
const labelCls = "mb-1 block font-mono text-[10px] tracking-[0.14em] text-ink-faint";

const ROLE_OPTS: { v: Role; label: string; hint: string }[] = [
  { v: "primary", label: "Primary", hint: "preferred master — runs schedules, watchers, automations" },
  { v: "backup", label: "Backup", hint: "takes over master duties if the primary goes down" },
  { v: "workstation", label: "Workstation", hint: "never master — just a place to work" },
];

const ago = (ts: number) => {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
};

export default function ClusterPanel() {
  const { addEvent } = useMission();
  const [st, setSt] = useState<Status | null>(null);
  const [role, setRole] = useState<Role>("backup");
  const [installDir, setInstallDir] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // don't let a background poll clobber fields the user is editing / saving
  const busyRef = useRef(false);
  busyRef.current = busy;
  const dirtyRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/cluster");
      if (res.ok) {
        const j = (await res.json()) as Status;
        setSt(j);
        if (!busyRef.current && !dirtyRef.current) {
          setRole(j.config.role);
          setInstallDir(j.config.installDir);
          setLabel(j.config.label);
        }
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [load]);

  const post = async (payload: Record<string, unknown>, note: string) => {
    setErr("");
    setBusy(true);
    try {
      const res = await fetch("/api/cluster", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = (await res.json()) as Status & { error?: string };
      if (!res.ok || j.error) setErr(j.error ?? "failed");
      else {
        setSt(j);
        dirtyRef.current = false;
        addEvent("CLUSTER", note, "cyan");
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const enabled = st?.config.enabled ?? false;

  return (
    <Panel
      title="Machine Group & Roles"
      delay={0.05}
      right={
        <span className="flex items-center gap-2 font-mono text-[10px] text-ink-faint">
          <StatusOrb accent={!enabled ? "cyan" : st?.masterIsSelf ? "lime" : st?.master ? "amber" : "rose"} pulsing={false} size={7} />
          {!enabled ? "standalone" : st?.masterIsSelf ? "this machine is MASTER" : st?.master ? `master: ${st.master}` : "no master"}
        </span>
      }
    >
      <div className="flex flex-col gap-4 p-5">
        {err && (
          <div role="alert" className="rounded-lg border border-neon-rose/30 bg-neon-rose/10 px-3 py-2 font-mono text-xs text-neon-rose">
            {err}
          </div>
        )}

        <p className="text-xs leading-6 text-ink-faint">
          Group your machines so only one — the <span className="text-ink">master</span> — runs schedules, watchers, and
          automations, and a <span className="text-ink">backup</span> automatically takes over if it goes down. Coordination
          runs through the shared vault (no direct network needed), so failover is eventually-consistent — it takes a couple
          of minutes, not seconds. Off by default: a lone machine just runs everything itself.
        </p>

        {/* this machine */}
        <div className="rounded-xl border border-line bg-white/[0.02] p-4">
          <div className="mb-3 flex items-center gap-2">
            <StatusOrb accent="lime" pulsing={false} size={8} />
            <p className="text-sm font-semibold text-ink">This machine · <span className="font-mono">{st?.self ?? "…"}</span></p>
          </div>

          <label className="mb-3 flex cursor-pointer items-center gap-2 text-xs text-ink-dim">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => post({ action: "config", enabled: e.target.checked, role, installDir, label }, e.target.checked ? "Clustering enabled" : "Clustering disabled")}
              className="cursor-pointer accent-current"
            />
            Enable machine-group coordination
          </label>

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className={labelCls} htmlFor="cl-label">DISPLAY NAME</label>
              <input id="cl-label" value={label} onChange={(e) => { setLabel(e.target.value); dirtyRef.current = true; }} placeholder="Desktop" className={inputCls} />
            </div>
            <div>
              <label className={labelCls} htmlFor="cl-role">ROLE</label>
              <select id="cl-role" value={role} onChange={(e) => { setRole(e.target.value as Role); dirtyRef.current = true; }} className={`${inputCls} cursor-pointer`}>
                {ROLE_OPTS.map((r) => (
                  <option key={r.v} value={r.v}>{r.label}</option>
                ))}
              </select>
            </div>
          </div>
          <p className="mt-1 text-[10px] leading-4 text-ink-faint">{ROLE_OPTS.find((r) => r.v === role)?.hint}</p>

          <div className="mt-3">
            <label className={labelCls} htmlFor="cl-dir">INSTALL FOLDER <span className="normal-case text-ink-faint">(where this app is installed on this machine)</span></label>
            <input id="cl-dir" value={installDir} onChange={(e) => { setInstallDir(e.target.value); dirtyRef.current = true; }} placeholder="C:\\Users\\you\\Documents\\mission-control" className={inputCls} />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <motion.button
              whileTap={{ scale: 0.96 }}
              onClick={() => post({ action: "config", enabled, role, installDir, label }, "Machine settings saved")}
              disabled={busy}
              className="flex h-9 cursor-pointer items-center gap-2 rounded-lg bg-gradient-to-br from-cyan-600 to-neon-cyan px-4 text-xs font-semibold text-white disabled:opacity-40"
            >
              <IconCheck width={14} height={14} /> Save
            </motion.button>
            {enabled && !st?.masterIsSelf && role !== "workstation" && (
              <button onClick={() => post({ action: "claim" }, "Claimed master")} disabled={busy} className="h-9 cursor-pointer rounded-lg border border-line px-3 text-xs text-ink-dim hover:bg-white/[0.06] disabled:opacity-40">
                Make this machine master
              </button>
            )}
            {enabled && st?.masterIsSelf && (
              <button onClick={() => post({ action: "release" }, "Stepped down as master")} disabled={busy} className="h-9 cursor-pointer rounded-lg border border-line px-3 text-xs text-ink-dim hover:bg-white/[0.06] disabled:opacity-40">
                Step down
              </button>
            )}
          </div>
        </div>

        {/* group members */}
        {enabled && (
          <div className="flex flex-col gap-2">
            <p className={labelCls}>GROUP MEMBERS {st && st.nodes.length > 0 ? `(${st.nodes.length})` : ""}</p>
            {!st?.vaultOk && <p className="text-[11px] text-neon-rose">Vault not reachable — the group can&apos;t coordinate until the vault syncs.</p>}
            {st && st.nodes.length === 0 && st.vaultOk && (
              <p className="text-[11px] text-ink-faint">No members yet — this machine will register within a minute, and other machines appear once they enable clustering too.</p>
            )}
            {st?.nodes.map((n) => (
              <div key={n.host} className="flex items-center gap-3 rounded-xl border border-line bg-white/[0.02] px-3 py-2.5">
                <StatusOrb accent={n.online ? "lime" : "rose"} pulsing={false} size={8} />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm text-ink">
                    <span className="font-semibold">{n.label || n.host}</span>
                    {n.self && <span className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[9px] text-ink-faint">this machine</span>}
                    {st.master === n.host && <span className="rounded bg-neon-lime/10 px-1.5 py-0.5 font-mono text-[9px] tracking-wide text-neon-lime">MASTER</span>}
                  </p>
                  <p className="truncate font-mono text-[10px] text-ink-faint">
                    {n.role} · {n.online ? `online · ${ago(n.ts)}` : `offline · ${ago(n.ts)}`} · {n.installDir}
                  </p>
                </div>
                {!n.self && (
                  <button onClick={() => post({ action: "forget", host: n.host }, `Forgot ${n.host}`)} aria-label={`Forget ${n.host}`} className="cursor-pointer rounded p-1 text-ink-faint transition-colors hover:text-neon-rose">
                    <IconTrash width={13} height={13} />
                  </button>
                )}
              </div>
            ))}
            <p className="pt-1 text-[11px] leading-4 text-ink-faint">
              Note: a backup that takes over runs the schedules, watchers, and automations. With every component installed
              on each machine it can also run Hermes and deliver via Telegram — just keep only ONE Telegram gateway
              (OpenClaw) polling the bot at a time, since two conflict.
            </p>
          </div>
        )}
      </div>
    </Panel>
  );
}
