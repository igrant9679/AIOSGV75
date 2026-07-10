"use client";

import Panel from "./ui/Panel";
import RingDial from "./ui/RingDial";
import NumberTicker from "./ui/NumberTicker";
import ClaudeConsole from "./ClaudeConsole";
import AgentLog from "./AgentLog";
import { useMission } from "./store";

/** Scale that keeps dials lively at small values but never pegged. */
const frac = (v: number, softMax: number) => 1 - Math.exp(-v / softMax);

export default function ClaudeSection() {
  const { claudeStats, system } = useMission();

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_300px]">
      <ClaudeConsole />

      <div className="flex flex-col gap-4">
        <Panel title="Session Telemetry" delay={0.05}>
          <div className="grid grid-cols-2 gap-x-2 gap-y-4 p-4">
            <RingDial frac={frac(claudeStats.totalCostUsd, 0.5)} accent="amber" size={110} label="Spend">
              <span className="font-mono text-sm font-semibold text-neon-amber">
                <NumberTicker value={claudeStats.totalCostUsd} decimals={3} prefix="$" />
              </span>
            </RingDial>
            <RingDial frac={frac(claudeStats.outputTokens, 8000)} accent="violet" size={110} label="Tokens Out">
              <span className="font-mono text-sm font-semibold text-neon-violet">
                <NumberTicker value={claudeStats.outputTokens} />
              </span>
            </RingDial>
            <RingDial frac={frac(claudeStats.turns, 20)} accent="cyan" size={110} label="Turns">
              <span className="font-mono text-sm font-semibold text-neon-cyan">
                <NumberTicker value={claudeStats.turns} />
              </span>
            </RingDial>
            <RingDial frac={frac(claudeStats.durationMs / 1000, 120)} accent="lime" size={110} label="Active Time">
              <span className="font-mono text-sm font-semibold text-neon-lime">
                <NumberTicker value={claudeStats.durationMs / 1000} decimals={0} suffix="s" />
              </span>
            </RingDial>
          </div>
        </Panel>

        <AgentLog source="CLAUDE" delay={0.08} />

        <Panel title="Bridge Detail" delay={0.1}>
          <dl className="flex flex-col gap-2.5 p-4 font-mono text-[11px]">
            <div className="flex justify-between">
              <dt className="text-ink-faint">CLI VERSION</dt>
              <dd className="text-ink-dim">{system?.claudeVersion ?? "not detected"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-faint">MISSIONS FLOWN</dt>
              <dd className="text-neon-cyan">{claudeStats.runs}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-faint">TOKENS IN</dt>
              <dd className="text-ink-dim">{claudeStats.inputTokens.toLocaleString()}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-faint">TRANSPORT</dt>
              <dd className="text-ink-dim">claude -p · stream-json · SSE</dd>
            </div>
          </dl>
        </Panel>
      </div>
    </div>
  );
}
