"use client";

import { useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import { streamSSE } from "@/lib/sse";
import Panel from "./ui/Panel";
import StatusOrb from "./ui/StatusOrb";
import Avatar from "./Avatar";
import ChatThread from "./chat/ChatThread";
import Composer from "./chat/Composer";
import AgentLog from "./AgentLog";
import { IconTrash } from "./icons";
import { useMission, runControllers } from "./store";

/** Fold older messages into a summary once a chat exceeds this many turns. */
const COMPACT_AFTER = 16;
const KEEP_TAIL = 8;

/** Chat page for a user-added API LLM (OpenRouter, DeepSeek, Kimi, …). */
export default function LLMSection({ llmId }: { llmId: string }) {
  const { registry, addEvent, chats, appendChat, appendText, clearChat, busy, setBusy, summaries, setSummary } =
    useMission();
  const llm = registry.llms.find((l) => l.id === llmId);

  const entries = chats[llmId] ?? [];
  const isBusy = busy[llmId] ?? false;
  const summary = summaries[llmId];

  // session compaction: after a run settles, fold old turns into a rolling summary
  const compacting = useRef(false);
  useEffect(() => {
    if (!llm || isBusy || compacting.current) return;
    const convo = entries.filter((e) => e.role === "user" || e.role === "assistant");
    const covered = summary?.covered ?? 0;
    if (convo.length - covered <= COMPACT_AFTER) return;
    const toFold = convo.slice(covered, convo.length - KEEP_TAIL);
    if (toFold.length === 0) return;
    compacting.current = true;
    fetch("/api/llm/compact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: llmId,
        previousSummary: summary?.text,
        messages: toFold.map((e) => ({ role: e.role, content: e.text })),
      }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { summary?: string } | null) => {
        if (j?.summary) {
          setSummary(llmId, j.summary, covered + toFold.length);
          appendChat(llmId, { role: "system", text: `context compacted — ${toFold.length} earlier messages summarized` });
          addEvent(llm.name.toUpperCase(), `Context compacted (${toFold.length} messages)`, "violet");
        }
      })
      .catch(() => {})
      .finally(() => {
        compacting.current = false;
      });
  }, [entries, isBusy, llm, llmId, summary, setSummary, appendChat, addEvent]);

  const send = useCallback(
    async (text: string) => {
      if (!llm) return;
      appendChat(llmId, { role: "user", text });
      setBusy(llmId, true);
      addEvent(llm.name.toUpperCase(), "Message sent", llm.accent);

      // uncompacted conversation history (user/assistant turns), incl. this message
      const covered = summary?.covered ?? 0;
      const history = [...entries, { id: "x", role: "user" as const, text, ts: Date.now() }]
        .filter((e) => e.role === "user" || e.role === "assistant")
        .slice(covered)
        .map((e) => ({ role: e.role as "user" | "assistant", content: e.text }));

      let liveId: string | null = null;
      const controller = new AbortController();
      runControllers.set(llmId, controller);
      const started = Date.now();

      try {
        await streamSSE(
          "/api/llm",
          { agentId: llmId, messages: history, summary: summary?.text },
          (ev) => {
            if (ev.type === "delta") {
              if (!liveId) liveId = appendChat(llmId, { role: "assistant", text: "" });
              appendText(llmId, liveId, ev.text as string);
            } else if (ev.type === "tool") {
              liveId = null; // post-tool text starts a fresh bubble
              appendChat(llmId, { role: "tool", text: `${ev.name} ${ev.detail ?? ""}` });
              addEvent(llm.name.toUpperCase(), `Tool engaged: ${ev.name}`, "violet");
            } else if (ev.type === "tool_result") {
              appendChat(llmId, { role: "tool", text: `↳ ${ev.detail ?? "done"}` });
            } else if (ev.type === "error") {
              appendChat(llmId, { role: "error", text: String(ev.message) });
              addEvent(llm.name.toUpperCase(), "API error — see chat", "rose");
              fetch("/api/usage", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ agent: llmId, kind: "chat", ms: Date.now() - started, ok: false }),
              }).catch(() => {});
            } else if (ev.type === "usage") {
              const secs = ((Date.now() - started) / 1000).toFixed(1);
              appendChat(llmId, {
                role: "system",
                text: `done · ${secs}s · ${ev.prompt_tokens ?? "?"} in / ${ev.completion_tokens ?? "?"} out tokens`,
              });
              addEvent(llm.name.toUpperCase(), `Reply in ${secs}s (${ev.completion_tokens ?? "?"} tokens)`, "lime");
              fetch("/api/usage", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  agent: llmId,
                  kind: "chat",
                  ms: Date.now() - started,
                  tokensIn: ev.prompt_tokens,
                  tokensOut: ev.completion_tokens,
                  ok: true,
                }),
              }).catch(() => {});
            }
          },
          controller.signal,
        );
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          appendChat(llmId, { role: "error", text: (err as Error).message });
          addEvent(llm.name.toUpperCase(), "Request failed", "rose");
        }
      } finally {
        setBusy(llmId, false);
        runControllers.delete(llmId);
      }
    },
    [llm, llmId, entries, summary, appendChat, appendText, addEvent, setBusy],
  );

  if (!llm) {
    return (
      <Panel title="LLM Agent">
        <p className="p-6 font-mono text-xs text-ink-faint">
          Unknown LLM agent. It may have been removed — check <Link href="/settings" className="text-neon-cyan">Settings</Link>.
        </p>
      </Panel>
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_300px]">
      <Panel
        className="flex flex-col"
        title={llm.name}
        right={
          <div className="flex items-center gap-2.5">
            <StatusOrb accent={llm.hasKey ? (isBusy ? "amber" : "lime") : "rose"} size={8} />
            <span className="font-mono text-[10px] text-ink-dim">{llm.hasKey ? llm.model : "no API key"}</span>
            <button
              onClick={() => clearChat(llmId)}
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
          agentName={llm.name}
          accent={llm.accent}
          busy={isBusy}
          heightClass="h-[calc(100dvh-19rem)] min-h-80"
          empty={
            <>
              <Avatar name={llm.name} accent={llm.accent} size={52} />
              <p className="text-sm font-medium text-ink">{llm.name} ready</p>
              <p className="max-w-sm text-xs leading-5 text-ink-faint">
                {llm.hasKey ? (
                  <>
                    {llm.provider} · {llm.model} — it reads your shared memory and can add to it with{" "}
                    <span className="font-mono text-neon-violet">&lt;remember&gt;</span> tags.
                  </>
                ) : (
                  <>
                    No API key saved yet — add one in{" "}
                    <Link href="/settings" className="text-neon-cyan underline-offset-2 hover:underline">
                      Settings
                    </Link>{" "}
                    to bring this agent online.
                  </>
                )}
              </p>
            </>
          }
        />

        <Composer accent={llm.accent} placeholder={`Message ${llm.name}…`} busy={isBusy} disabled={!llm.hasKey} onSend={send} onStop={() => runControllers.get(llmId)?.abort()} />
      </Panel>

      <div className="flex flex-col gap-4">
        <AgentLog source={llm.name} delay={0.05} />

        <Panel title="Connection" delay={0.1}>
          <dl className="flex flex-col gap-2.5 p-4 font-mono text-[11px]">
            <div>
              <dt className="text-ink-faint">PROVIDER</dt>
              <dd className="text-ink-dim">{llm.provider}</dd>
            </div>
            <div>
              <dt className="text-ink-faint">MODEL</dt>
              <dd className="text-ink-dim">{llm.model}</dd>
            </div>
            <div>
              <dt className="text-ink-faint">ENDPOINT</dt>
              <dd className="break-all text-ink-dim">{llm.baseUrl}</dd>
            </div>
            <div>
              <dt className="text-ink-faint">API KEY</dt>
              <dd className={llm.hasKey ? "text-neon-lime" : "text-neon-rose"}>{llm.hasKey ? "saved" : "missing"}</dd>
            </div>
            <Link href="/settings" className="mt-1 text-neon-cyan underline-offset-2 hover:underline">
              Edit in Settings →
            </Link>
          </dl>
        </Panel>
      </div>
    </div>
  );
}
