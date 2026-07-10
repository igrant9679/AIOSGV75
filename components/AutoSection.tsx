"use client";

import { useCallback } from "react";
import Link from "next/link";
import Panel from "./ui/Panel";
import StatusOrb from "./ui/StatusOrb";
import Avatar from "./Avatar";
import ChatThread from "./chat/ChatThread";
import Composer from "./chat/Composer";
import AgentLog from "./AgentLog";
import { IconTrash } from "./icons";
import { useMission, runControllers } from "./store";

const CHAT_ID = "auto";

/** Chat page for the smart-routing Auto agent. */
export default function AutoSection() {
  const { addEvent, chats, appendChat, clearChat, busy, setBusy, registry } = useMission();

  const entries = chats[CHAT_ID] ?? [];
  const isBusy = busy[CHAT_ID] ?? false;
  const readyModels = 1 + registry.llms.filter((l) => l.hasKey).length; // claude + keyed LLMs

  const send = useCallback(
    async (text: string) => {
      appendChat(CHAT_ID, { role: "user", text });
      setBusy(CHAT_ID, true);
      addEvent("AUTO", "Routing task…", "cyan");

      const history = entries
        .filter((e) => e.role === "user" || e.role === "assistant")
        .map((e) => ({ role: e.role as "user" | "assistant", content: e.text }));

      const controller = new AbortController();
      runControllers.set(CHAT_ID, controller);
      try {
        const res = await fetch("/api/auto", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: text, history }),
          signal: controller.signal,
        });
        const json = (await res.json()) as {
          text?: string;
          ms?: number;
          error?: string;
          routedTo?: string;
          reason?: string;
        };
        if (json.routedTo) {
          appendChat(CHAT_ID, { role: "system", text: `→ ${json.routedTo} · ${json.reason ?? ""}` });
          addEvent("AUTO", `Routed to ${json.routedTo}`, "violet");
        }
        if (json.error) {
          appendChat(CHAT_ID, { role: "error", text: json.error });
          addEvent("AUTO", "Run failed", "rose");
        } else if (json.text) {
          appendChat(CHAT_ID, { role: "assistant", text: json.text });
          addEvent("AUTO", `Answer in ${(((json.ms ?? 0) / 1000) || 0).toFixed(1)}s`, "lime");
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          appendChat(CHAT_ID, { role: "error", text: (err as Error).message });
        }
      } finally {
        setBusy(CHAT_ID, false);
        runControllers.delete(CHAT_ID);
      }
    },
    [entries, appendChat, addEvent, setBusy],
  );

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_300px]">
      <Panel
        className="flex flex-col"
        title="Auto — Smart Router"
        right={
          <div className="flex items-center gap-2.5">
            <StatusOrb accent={isBusy ? "amber" : "lime"} size={8} />
            <span className="font-mono text-[10px] text-ink-dim">{readyModels} models in pool</span>
            <button
              onClick={() => clearChat(CHAT_ID)}
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
          agentName="Auto"
          accent="cyan"
          busy={isBusy}
          heightClass="h-[calc(100dvh-19rem)] min-h-80"
          empty={
            <>
              <Avatar name="Auto" accent="cyan" size={52} />
              <p className="text-sm font-medium text-ink">One agent, whole fleet</p>
              <p className="max-w-sm text-xs leading-5 text-ink-faint">
                Auto reads each task and routes it — cheap models for simple questions, arena champions for hard ones,
                with automatic failover to Claude if the pick errors. Every reply shows who answered and why.
              </p>
            </>
          }
        />
        <Composer accent="cyan" placeholder="Ask anything — Auto picks the right model…" busy={isBusy} onSend={send} onStop={() => runControllers.get(CHAT_ID)?.abort()} />
      </Panel>

      <div className="flex flex-col gap-4">
        <AgentLog source="AUTO" delay={0.05} />

        <Panel title="How Routing Works" delay={0.1}>
          <div className="flex flex-col gap-3 p-4 text-[11.5px] leading-5 text-ink-dim">
            <p>
              <span className="font-semibold text-neon-lime">Simple</span> — short, factual → cheapest ready model.
            </p>
            <p>
              <span className="font-semibold text-neon-amber">Standard</span> — proven performer by{" "}
              <Link href="/arena" className="text-neon-cyan underline-offset-2 hover:underline">
                Arena
              </Link>{" "}
              win-rate, else a balanced pick.
            </p>
            <p>
              <span className="font-semibold text-neon-rose">Hard</span> — code, analysis, writing → the top arena
              champion.
            </p>
            <p>
              Signals sharpen as you use the OS: crown arena winners and the{" "}
              <Link href="/analytics" className="text-neon-cyan underline-offset-2 hover:underline">
                usage ledger
              </Link>{" "}
              tracks cost, latency, and reliability per model.
            </p>
          </div>
        </Panel>
      </div>
    </div>
  );
}
