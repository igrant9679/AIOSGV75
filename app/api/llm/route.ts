import { findLlm } from "@/lib/registry";
import { gatherContext, memorySystemBlock, type AgentContext } from "@/lib/retrieval";
import { TOOL_DEFS, executeTool } from "@/lib/llmTools";

export const dynamic = "force-dynamic";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface AccumulatedToolCall {
  id: string;
  name: string;
  args: string;
}

const MAX_TOOL_ROUNDS = 5;

function buildSystemPrompt(agentName: string, custom: string | undefined, ctx: AgentContext, summary?: string): string {
  const persona = custom?.trim() || `You are ${agentName}, an AI agent on the user's local Mission Control dashboard.`;
  const compacted = summary?.trim()
    ? `\n\nEARLIER CONVERSATION (older messages, summarized):\n${summary.trim()}`
    : "";
  const tools = `\n\nYou have native function tools (search_vault, read_note, save_memory, add_goal, list_goals, append_journal, request_mission) — prefer them over the tag verbs when you need to act.`;
  return `${persona}${compacted}\n\n${memorySystemBlock(ctx)}${tools}`;
}

/**
 * Streaming agentic bridge to any OpenAI-compatible chat API. Runs a tool
 * loop: text deltas stream straight to the client; tool_call deltas are
 * accumulated, executed locally (lib/llmTools.ts), and fed back until the
 * model produces a final answer. Providers that reject the `tools` param get
 * one transparent retry without tools.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as { agentId?: string; messages?: ChatMessage[]; summary?: string };
  const llm = body.agentId ? await findLlm(body.agentId) : undefined;
  if (!llm) return Response.json({ error: "unknown LLM agent" }, { status: 400 });
  if (!llm.apiKey) return Response.json({ error: `No API key saved for ${llm.name} — add one in Settings` }, { status: 400 });

  const history = (body.messages ?? [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-40);
  if (history.length === 0) return Response.json({ error: "messages required" }, { status: 400 });

  const lastUser = [...history].reverse().find((m) => m.role === "user")?.content ?? "";
  const ctx = await gatherContext(lastUser);
  // convo grows as tool rounds append assistant tool_calls + tool results
  const convo: Record<string, unknown>[] = [
    { role: "system", content: buildSystemPrompt(llm.name, llm.systemPrompt, ctx, body.summary) },
    ...history,
  ];

  const encoder = new TextEncoder();
  const callUpstream = (withTools: boolean) =>
    fetch(`${llm.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${llm.apiKey}` },
      body: JSON.stringify({
        model: llm.model,
        messages: convo,
        stream: true,
        ...(withTools ? { tools: TOOL_DEFS } : {}),
      }),
      signal: request.signal,
    });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

      let toolsEnabled = true;
      try {
        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          let upstream: Response;
          try {
            upstream = await callUpstream(toolsEnabled);
          } catch (err) {
            if ((err as Error).name !== "AbortError") {
              send({ type: "error", message: `Could not reach ${llm.baseUrl}: ${(err as Error).message}` });
            }
            break;
          }

          if (!upstream.ok || !upstream.body) {
            const detail = (await upstream.text().catch(() => "")).slice(0, 500);
            // some OpenAI-compatible providers don't support tools — retry once without
            if (toolsEnabled && upstream.status >= 400 && upstream.status < 500 && /tool/i.test(detail)) {
              toolsEnabled = false;
              round--;
              continue;
            }
            send({ type: "error", message: `${llm.name} API error ${upstream.status}: ${detail || upstream.statusText}` });
            break;
          }

          const reader = upstream.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let finish: string | null = null;
          let text = "";
          const toolCalls = new Map<number, AccumulatedToolCall>();

          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith("data:")) continue;
              const payload = trimmed.slice(5).trim();
              if (payload === "[DONE]") continue;
              try {
                const json = JSON.parse(payload) as {
                  choices?: {
                    delta?: {
                      content?: string;
                      tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[];
                    };
                    finish_reason?: string | null;
                  }[];
                  usage?: { prompt_tokens?: number; completion_tokens?: number };
                  error?: { message?: string };
                };
                if (json.error?.message) send({ type: "error", message: json.error.message });
                const choice = json.choices?.[0];
                if (choice?.delta?.content) {
                  text += choice.delta.content;
                  send({ type: "delta", text: choice.delta.content });
                }
                for (const tc of choice?.delta?.tool_calls ?? []) {
                  const i = tc.index ?? 0;
                  const acc = toolCalls.get(i) ?? { id: "", name: "", args: "" };
                  if (tc.id) acc.id = tc.id;
                  if (tc.function?.name) acc.name = tc.function.name;
                  if (tc.function?.arguments) acc.args += tc.function.arguments;
                  toolCalls.set(i, acc);
                }
                if (choice?.finish_reason) finish = choice.finish_reason;
                if (json.usage) send({ type: "usage", ...json.usage });
              } catch {
                /* malformed upstream frame */
              }
            }
          }

          if (finish === "tool_calls" && toolCalls.size > 0) {
            const calls = [...toolCalls.values()].filter((c) => c.name);
            convo.push({
              role: "assistant",
              content: text || null,
              tool_calls: calls.map((c) => ({
                id: c.id || `call_${Math.abs(c.name.length * 7919)}`,
                type: "function",
                function: { name: c.name, arguments: c.args || "{}" },
              })),
            });
            for (const call of calls) {
              send({ type: "tool", name: call.name, detail: call.args.slice(0, 200) });
              const result = await executeTool(call.name, call.args, llm.id);
              send({ type: "tool_result", name: call.name, detail: result.slice(0, 200) });
              convo.push({ role: "tool", tool_call_id: call.id || `call_${Math.abs(call.name.length * 7919)}`, content: result.slice(0, 4000) });
            }
            continue; // next round with tool results in context
          }
          break; // final answer delivered
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          send({ type: "error", message: (err as Error).message });
        }
      }
      send({ type: "done" });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
