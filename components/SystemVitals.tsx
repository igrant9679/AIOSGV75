"use client";

import Panel from "./ui/Panel";
import Gauge from "./ui/Gauge";
import Sparkline from "./ui/Sparkline";
import NumberTicker from "./ui/NumberTicker";
import { useMission } from "./store";

function fmtUptime(s: number) {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${m}m`;
}

export default function SystemVitals({ delay = 0 }: { delay?: number }) {
  const { system, cpuHistory, memHistory } = useMission();
  const memPct = system ? (system.memUsed / system.memTotal) * 100 : 0;
  const memGb = system ? system.memUsed / 1024 ** 3 : 0;
  const memTotalGb = system ? system.memTotal / 1024 ** 3 : 0;
  const diskPct = system?.diskUsed && system.diskTotal ? (system.diskUsed / system.diskTotal) * 100 : null;

  return (
    <Panel title="Host Vitals · VPS/Local Computer" delay={delay}>
      <div className="flex flex-wrap items-center justify-around gap-x-6 gap-y-3 px-4 py-3">
        <div className="flex flex-col items-center">
          <Gauge value={system?.cpu ?? 0} label="CPU Load" unit="%" accent="cyan" size={168} />
          <Sparkline data={cpuHistory} accent="cyan" width={150} height={34} max={100} />
        </div>
        <div className="flex flex-col items-center">
          <Gauge value={memPct} label="Memory" unit="%" accent="magenta" size={168} />
          <Sparkline data={memHistory} accent="magenta" width={150} height={34} max={100} />
        </div>
        <dl className="grid grid-cols-1 gap-3 font-mono text-[11px]">
          <div>
            <dt className="panel-title">RAM In Use</dt>
            <dd className="text-base font-semibold text-neon-magenta">
              <NumberTicker value={memGb} decimals={1} suffix={` / ${memTotalGb.toFixed(0)} GB`} />
            </dd>
          </div>
          <div>
            <dt className="panel-title">Disk</dt>
            <dd className="text-base font-semibold text-neon-cyan">
              {diskPct !== null && system?.diskUsed && system.diskTotal ? (
                <NumberTicker
                  value={system.diskUsed / 1024 ** 3}
                  decimals={0}
                  suffix={` / ${(system.diskTotal / 1024 ** 3).toFixed(0)} GB · ${diskPct.toFixed(0)}%`}
                />
              ) : (
                "—"
              )}
            </dd>
          </div>
          <div>
            <dt className="panel-title">Data Stores</dt>
            <dd className="text-base font-semibold text-neon-amber">
              {system?.dataBytes !== undefined ? `${(system.dataBytes / 1024 ** 2).toFixed(2)} MB` : "—"}
            </dd>
          </div>
          <div>
            <dt className="panel-title">Uptime</dt>
            <dd className="text-base font-semibold text-neon-lime">
              {system ? fmtUptime(system.uptime) : "—"}
            </dd>
          </div>
          <div>
            <dt className="panel-title">Platform</dt>
            <dd className="text-ink-dim">{system?.platform ?? "—"}</dd>
          </div>
        </dl>
      </div>
    </Panel>
  );
}
