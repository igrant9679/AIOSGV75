"use client";

import { useCallback } from "react";
import { streamSSE } from "@/lib/sse";
import type { PermissionMode } from "@/lib/types";
import { useLocalStorageState } from "@/lib/useLocalStorageState";
import Panel from "./ui/Panel";
import StatusOrb from "./ui/StatusOrb";
import Avatar from "./Avatar";
import ChatThread from "./chat/ChatThread";
import Composer from "./chat/Composer";
import { IconTrash } from "./icons";
import { useMission, runControllers } from "./store";

const CHAT_ID = "claude";

const MODELS = [
  { id: "", label: "Default model" },
  { id: "sonnet", label: "Sonnet" },
  { id: "opus", label: "Opus" },
  { id: "haiku", label: "Haiku" },
];

const MODES: { id: PermissionMode; label: string; hint: string }[] = [
  { id: "default", label: "Safe", hint: "tools needing approval are declined" },
  { id: "plan", label: "Plan", hint: "read-only planning mode" },
  { id: "acceptEdits", label: "Auto-Edit", hint: "file edits auto-approved" },
  { id: "bypassPermissions", label: "Full Access", hint: "all tools auto-approved — trusted prompts only" },
];

function extractToolResultText(msg: unknown): string {
  const content = (msg as { message?: { content?: unknown } })?.message?.content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (block?.type !== "tool_result") continue;
    if (typeof block.content === "string") parts.push(block.content);
    else if (Array.isArray(block.content)) {
      for (const inner of block.content) {
        if (inner?.type === "text" && typeof inner.text === "string") parts.push(inner.text);
      }
    }
  }
  return parts.join("\n");
}

export default function ClaudeConsole({ heightClass = "h-[calc(100dvh-21rem)] min-h-80" }: { heightClass?: string }) {
  const {
    addEvent,
    bumpClaudeStats,
    system,
    chats,
    appendChat,
    appendText,
    clearChat,
    sessions,
    setSession,
    busy,
    setBusy,
  } = useMission();

  const [model, setModel] = useLocalStorageState<string>("mc-model", "");
  const [mode, setMode] = useLocalStorageState<PermissionMode>("mc-mode", "default");

  const entries = chats[CHAT_ID] ?? [];
  const sessionId = sessions[CHAT_ID] ?? null;
  const isBusy = busy[CHAT_ID] ?? false;

  const send = useCallback(
    async (prompt: string) => {
      appendChat(CHAT_ID, { role: "user", text: prompt });
      setBusy(CHAT_ID, true);
      addEvent("CLAUDE", "Message sent to Claude", "cyan");

      // per-run streaming state, captured by this closure so it survives navigation
      let liveId: string | null = null;
      let streamed = false;

      const controller = new AbortController();
      runControllers.set(CHAT_ID, controller);

      const handleEvent = (ev: Record<string, unknown>) => {
        const type = ev.type as string;

        if (type === "system" && ev.subtype === "init") {
          setSession(CHAT_ID, ev.session_id as string);
          return;
        }

        if (type === "stream_event") {
          const inner = ev.event as {
            type?: string;
            delta?: { type?: string; text?: string };
            content_block?: { type?: string };
          };
          if (inner?.type === "message_start") {
            streamed = false;
          } else if (inner?.type === "content_block_start" && inner.content_block?.type === "text") {
            liveId = appendChat(CHAT_ID, { role: "assistant", text: "" });
          } else if (inner?.type === "content_block_delta" && inner.delta?.type === "text_delta" && inner.delta.text) {
            streamed = true;
            if (liveId) appendText(CHAT_ID, liveId, inner.delta.text);
          }
          return;
        }

        if (type === "assistant") {
          const content = (ev as { message?: { content?: unknown } }).message?.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block?.type === "tool_use") {
                const preview = JSON.stringify(block.input ?? {}).slice(0, 140);
                appendChat(CHAT_ID, { role: "tool", text: `${block.name} ${preview}` });
                addEvent("CLAUDE", `Tool engaged: ${block.name}`, "violet");
              } else if (block?.type === "text" && block.text && !streamed) {
                // synthetic/error messages arrive without stream deltas
                appendChat(CHAT_ID, { role: "assistant", text: block.text });
              }
            }
          }
          return;
        }

        if (type === "user") {
          const text = extractToolResultText(ev).trim();
          if (text) {
            appendChat(CHAT_ID, {
              role: "tool",
              text: `↳ ${text.length > 280 ? text.slice(0, 280) + " …" : text}`,
              meta: "result",
            });
          }
          return;
        }

        if (type === "result") {
          const usage = (ev.usage ?? {}) as { input_tokens?: number; output_tokens?: number };
          bumpClaudeStats({
            totalCostUsd: (ev.total_cost_usd as number) ?? 0,
            durationMs: (ev.duration_ms as number) ?? 0,
            turns: (ev.num_turns as number) ?? 0,
            inputTokens: usage.input_tokens ?? 0,
            outputTokens: usage.output_tokens ?? 0,
            runs: 1,
          });
          fetch("/api/usage", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              agent: "claude",
              kind: "chat",
              ms: (ev.duration_ms as number) ?? 0,
              costUsd: ev.total_cost_usd as number | undefined,
              tokensIn: usage.input_tokens,
              tokensOut: usage.output_tokens,
              ok: !ev.is_error,
            }),
          }).catch(() => {});
          const cost = ev.total_cost_usd != null ? `$${(ev.total_cost_usd as number).toFixed(4)}` : "n/a";
          const secs = (((ev.duration_ms as number) ?? 0) / 1000).toFixed(1);
          if (ev.is_error) {
            appendChat(CHAT_ID, { role: "error", text: `Run failed · ${secs}s · ${ev.result ?? "see output above"}` });
            addEvent("CLAUDE", "Run failed — see console", "rose");
          } else {
            appendChat(CHAT_ID, { role: "system", text: `done · ${secs}s · ${ev.num_turns} turns · ${cost}` });
            addEvent("CLAUDE", `Run finished in ${secs}s (${cost})`, "lime");
          }
          return;
        }

        if (type === "bridge_error") {
          appendChat(CHAT_ID, { role: "error", text: `${ev.message}${ev.stderr ? `\n${ev.stderr}` : ""}` });
          addEvent("CLAUDE", "Bridge error — see console", "rose");
        }
      };

      try {
        // server injects retrieved shared memory on the first message of a session
        await streamSSE(
          "/api/claude",
          {
            prompt,
            sessionId: sessionId ?? undefined,
            model: model || undefined,
            permissionMode: mode,
            injectMemory: !sessionId,
          },
          handleEvent,
          controller.signal,
        );
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          appendChat(CHAT_ID, { role: "error", text: (err as Error).message });
        }
      } finally {
        setBusy(CHAT_ID, false);
        runControllers.delete(CHAT_ID);
      }
    },
    [addEvent, appendChat, appendText, bumpClaudeStats, mode, model, sessionId, setBusy, setSession],
  );

  const stop = useCallback(() => {
    runControllers.get(CHAT_ID)?.abort();
    appendChat(CHAT_ID, { role: "system", text: "stopped by operator" });
    addEvent("CLAUDE", "Run aborted", "amber");
  }, [appendChat, addEvent]);

  const online = Boolean(system?.claudeVersion);

  return (
    <Panel
      className="flex flex-col"
      title="Claude"
      right={
        <div className="flex items-center gap-2.5">
          <StatusOrb accent={online ? (isBusy ? "amber" : "lime") : "rose"} size={8} />
          <span className="font-mono text-[10px] text-ink-dim">
            {sessionId ? `session ${sessionId.slice(0, 8)}` : "new session"}
          </span>
          <button
            onClick={() => {
              clearChat(CHAT_ID);
              addEvent("CLAUDE", "Chat cleared — fresh session", "violet");
            }}
            title="Clear chat / new session"
            aria-label="Clear chat and start new session"
            className="cursor-pointer rounded-lg p-1.5 text-ink-faint transition-colors hover:bg-white/[0.06] hover:text-neon-rose"
          >
            <IconTrash width={14} height={14} />
          </button>
        </div>
      }
    >
      <ChatThread
        entries={entries}
        agent="claude"
        accent="violet"
        busy={isBusy}
        heightClass={heightClass}
        empty={
          <>
            <Avatar kind="claude" size={52} />
            <p className="text-sm font-medium text-ink">Talk to Claude on this machine</p>
            <p className="max-w-sm text-xs leading-5 text-ink-faint">
              Messages are piped into the local <span className="font-mono text-neon-violet">claude</span> CLI.
              It can read, write, and run things here — pick a permission mode below.
            </p>
          </>
        }
      />

      <Composer
        accent="violet"
        placeholder="Message Claude…"
        busy={isBusy}
        disabled={!online}
        onSend={send}
        onStop={stop}
        toolbar={
          <>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              aria-label="Model"
              className="cursor-pointer rounded-lg border border-line bg-panel-2 px-2.5 py-1.5 font-mono text-[11px] text-ink-dim outline-none focus:border-line-bright"
            >
              {MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
            <div className="flex overflow-hidden rounded-lg border border-line" role="radiogroup" aria-label="Permission mode">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  role="radio"
                  aria-checked={mode === m.id}
                  title={m.hint}
                  onClick={() => setMode(m.id)}
                  className={`cursor-pointer px-2.5 py-1.5 font-mono text-[10px] tracking-wide transition-colors ${
                    mode === m.id
                      ? m.id === "bypassPermissions"
                        ? "bg-neon-rose/20 text-neon-rose"
                        : "bg-neon-violet/20 text-neon-violet"
                      : "text-ink-faint hover:bg-white/[0.04]"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </>
        }
      />
    </Panel>
  );
}
