"use client";

import { useCallback } from "react";
import { streamSSE } from "@/lib/sse";
import { ACCENTS } from "@/lib/accents";
import Panel from "./ui/Panel";
import RingDial from "./ui/RingDial";
import NumberTicker from "./ui/NumberTicker";
import StatusOrb from "./ui/StatusOrb";
import Avatar, { type AvatarKind } from "./Avatar";
import ChatThread from "./chat/ChatThread";
import Composer from "./chat/Composer";
import AgentLog from "./AgentLog";
import { IconTrash, IconWrench } from "./icons";
import { useMission, runControllers } from "./store";

/** Chat bay for a companion agent (OpenClaw, Hermes, …). */
export default function AgentSection({ agentId }: { agentId: string }) {
  const { agents, addEvent, chats, appendChat, appendText, clearChat, busy, setBusy } = useMission();
  const agent = agents.find((a) => a.id === agentId);

  const entries = chats[agentId] ?? [];
  const isBusy = busy[agentId] ?? false;
  const runs = entries.filter((e) => e.role === "system" && e.text.startsWith("exited")).length;
  const outChars = entries.filter((e) => e.role === "assistant").reduce((n, e) => n + e.text.length, 0);

  const send = useCallback(
    async (message: string) => {
      if (!agent) return;
      appendChat(agentId, { role: "user", text: message });
      setBusy(agentId, true);
      addEvent(agent.name.toUpperCase(), "Command dispatched", agent.accent);

      let liveId: string | null = null;
      let liveErrId: string | null = null;
      const controller = new AbortController();
      runControllers.set(agentId, controller);

      try {
        await streamSSE(
          "/api/agents/run",
          { agentId, input: message, injectMemory: true },
          (ev) => {
            if (ev.type === "stdout") {
              if (!liveId) liveId = appendChat(agentId, { role: "assistant", text: "" });
              appendText(agentId, liveId, ev.text as string);
            } else if (ev.type === "stderr") {
              // progress/log noise, not a failure — render as a dim tool card
              if (!liveErrId) liveErrId = appendChat(agentId, { role: "tool", text: "" });
              appendText(agentId, liveErrId, ev.text as string);
            } else if (ev.type === "error") {
              appendChat(agentId, { role: "error", text: `launch failed: ${ev.message}` });
            } else if (ev.type === "done") {
              appendChat(agentId, { role: "system", text: `exited (${ev.code})` });
              addEvent(agent.name.toUpperCase(), `Run complete (exit ${ev.code})`, ev.code === 0 ? "lime" : "rose");
            }
          },
          controller.signal,
        );
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          appendChat(agentId, { role: "error", text: (err as Error).message });
        }
      } finally {
        setBusy(agentId, false);
        runControllers.delete(agentId);
      }
    },
    [agent, agentId, appendChat, appendText, addEvent, setBusy],
  );

  const stop = useCallback(() => {
    runControllers.get(agentId)?.abort();
    appendChat(agentId, { role: "system", text: "stopped by operator" });
  }, [agentId, appendChat]);

  if (!agent) {
    return (
      <Panel title="Agent Bay">
        <p className="p-6 font-mono text-xs text-ink-faint">Probing agent registry…</p>
      </Panel>
    );
  }

  const c = ACCENTS[agent.accent];
  const kind = agentId as AvatarKind;

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_300px]">
      <Panel
        className="flex flex-col"
        title={agent.name}
        right={
          <div className="flex items-center gap-2.5">
            <StatusOrb accent={agent.available ? (isBusy ? "amber" : "lime") : "rose"} size={8} />
            <span className="font-mono text-[10px] text-ink-dim">
              {agent.available ? (agent.version ?? "online") : "offline"}
            </span>
            <button
              onClick={() => clearChat(agentId)}
              title="Clear chat"
              aria-label="Clear chat"
              className="cursor-pointer rounded-lg p-1.5 text-ink-faint transition-colors hover:bg-white/[0.06] hover:text-neon-rose"
            >
              <IconTrash width={14} height={14} />
            </button>
          </div>
        }
      >
        <ChatThread
          entries={entries}
          agent={kind}
          accent={agent.accent}
          busy={isBusy}
          heightClass="h-[calc(100dvh-19rem)] min-h-80"
          empty={
            agent.available ? (
              <>
                <Avatar kind={kind} size={52} />
                <p className="text-sm font-medium text-ink">{agent.name} standing by</p>
                <p className="max-w-sm font-mono text-[11px] leading-5 text-ink-faint">{agent.commandTemplate}</p>
              </>
            ) : (
              <>
                <Avatar kind={kind} size={52} />
                <div className="flex max-w-md items-start gap-3 rounded-2xl border border-neon-rose/25 bg-neon-rose/10 p-4 text-left text-xs leading-5 text-ink-dim">
                  <IconWrench className="mt-0.5 shrink-0 text-neon-rose" />
                  <div>
                    <p className="font-semibold text-neon-rose">
                      Binary &lsquo;{agent.binary}&rsquo; was not found on this machine.
                    </p>
                    <p className="mt-1">
                      Install it, or point the bridge at your own command via{" "}
                      <span className="text-neon-amber">{agent.id.toUpperCase()}_BIN</span> /{" "}
                      <span className="text-neon-amber">{agent.id.toUpperCase()}_CMD</span> in{" "}
                      <span className="text-ink">.env.local</span>, then restart. You can still send commands — the
                      failure output will show here.
                    </p>
                  </div>
                </div>
              </>
            )
          }
        />

        <Composer
          accent={agent.accent}
          placeholder={`Message ${agent.name}…`}
          busy={isBusy}
          onSend={send}
          onStop={stop}
        />
      </Panel>

      <div className="flex flex-col gap-4">
        <AgentLog source={agent.name} delay={0.03} />

        <Panel title="Telemetry" delay={0.05}>
          <div className="grid grid-cols-2 gap-2 p-4">
            <RingDial frac={1 - Math.exp(-runs / 5)} accent={agent.accent} size={104} label="Sorties">
              <span className="font-mono text-sm font-semibold" style={{ color: c.base }}>
                <NumberTicker value={runs} />
              </span>
            </RingDial>
            <RingDial frac={1 - Math.exp(-outChars / 4000)} accent="cyan" size={104} label="Output">
              <span className="font-mono text-sm font-semibold text-neon-cyan">
                <NumberTicker value={outChars} />
              </span>
            </RingDial>
          </div>
        </Panel>

        <Panel title="Adapter" delay={0.1}>
          <dl className="flex flex-col gap-2.5 p-4 font-mono text-[11px]">
            <div>
              <dt className="text-ink-faint">ROLE</dt>
              <dd className="text-ink-dim">{agent.tagline}</dd>
            </div>
            <div>
              <dt className="text-ink-faint">BINARY</dt>
              <dd className="text-ink-dim">{agent.binary}</dd>
            </div>
            <div>
              <dt className="text-ink-faint">COMMAND TEMPLATE</dt>
              <dd className="break-all text-ink-dim">{agent.commandTemplate}</dd>
            </div>
            <div>
              <dt className="text-ink-faint">OVERRIDE</dt>
              <dd className="text-ink-dim">
                {agent.id.toUpperCase()}_BIN · {agent.id.toUpperCase()}_CMD in .env.local
              </dd>
            </div>
          </dl>
        </Panel>
      </div>
    </div>
  );
}
