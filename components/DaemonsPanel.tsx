"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import Panel from "./ui/Panel";
import StatusOrb from "./ui/StatusOrb";
import { IconRocket } from "./icons";
import { useMission } from "./store";

interface DaemonInfo {
  id: string;
  label: string;
  detail: string;
  port: number;
  manual: string;
  installed: boolean;
  running: boolean;
}

export default function DaemonsPanel() {
  const { addEvent } = useMission();
  const [services, setServices] = useState<DaemonInfo[]>([]);
  const [starting, setStarting] = useState<string | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/daemons");
      if (res.ok) setServices(((await res.json()) as { services: DaemonInfo[] }).services ?? []);
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 12_000);
    return () => clearInterval(t);
  }, [load]);

  const start = async (d: DaemonInfo) => {
    setErr("");
    setStarting(d.id);
    try {
      const res = await fetch("/api/daemons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: d.id }),
      });
      const j = (await res.json()) as { ok?: boolean; already?: boolean; error?: string };
      if (!res.ok || j.error) setErr(j.error ?? "could not start service");
      else addEvent("SERVICES", `${d.label} ${j.already ? "already running" : "started"}`, "lime");
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setStarting(null);
    }
  };

  const orbFor = (d: DaemonInfo) => (d.running ? "lime" : d.installed ? "amber" : "rose");

  return (
    <Panel
      title="Local Services"
      right={<span className="font-mono text-[10px] text-ink-faint">auto-start on boot</span>}
    >
      <div className="flex flex-col gap-2 p-4">
        {err && (
          <div role="alert" className="rounded-lg border border-neon-rose/30 bg-neon-rose/10 px-3 py-2 font-mono text-[11px] text-neon-rose">
            {err}
          </div>
        )}
        {services.map((d) => (
          <div key={d.id} className="flex items-center gap-3 rounded-xl border border-line bg-white/[0.02] px-3 py-2.5">
            <StatusOrb accent={orbFor(d)} pulsing={starting === d.id} size={8} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink">{d.label}</p>
              <p className="truncate font-mono text-[10px] text-ink-faint">
                {d.running ? `running · port ${d.port}` : d.installed ? `stopped · ${d.manual}` : "not installed on this machine"}
              </p>
            </div>
            {d.running ? (
              <span className="rounded bg-neon-lime/10 px-2 py-0.5 font-mono text-[9px] tracking-wide text-neon-lime">RUNNING</span>
            ) : (
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={() => start(d)}
                disabled={!d.installed || starting === d.id}
                className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs text-ink-dim transition-colors hover:bg-white/[0.06] hover:text-neon-lime disabled:cursor-not-allowed disabled:opacity-40"
              >
                <IconRocket width={13} height={13} /> {starting === d.id ? "Starting…" : "Start"}
              </motion.button>
            )}
          </div>
        ))}
        <p className="px-1 pt-1 text-[11px] leading-4 text-ink-faint">
          These companion services start automatically when Mission Control boots — including after a system restart, since
          the app itself launches at login. Use Start to bring one up now without waiting.
        </p>
      </div>
    </Panel>
  );
}
