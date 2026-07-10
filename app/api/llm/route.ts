import { findLlm } from "@/lib/registry";
import { gatherContext, memorySystemBlock, type AgentContext } from "@/lib/retrieval";

export const dynamic = "force-dynamic";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

function buildSystemPrompt(agentName: string, custom: string | undefined, ctx: AgentContext, summary?: string): string {
  const persona = custom?.trim() || `You are ${agentName}, an AI agent on the user's local Mission Control dashboard.`;
  const compacted = summary?.trim()
    ? `\n\nEARLIER CONVERSATION (older messages, summarized):\n${summary.trim()}`
    : "";
  return `${persona}${compacted}\n\n${memorySystemBlock(ctx)}`;
}

/**
 * Streaming bridge to any OpenAI-compatible chat API (OpenRouter, DeepSeek,
 * Kimi, GLM, Grok, Gemini, custom). Config and keys come from the server-side
 * registry only. Relays deltas as SSE frames: {type:"delta"|"done"|"error"}.
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
  const messages = [
    { role: "system", content: buildSystemPrompt(llm.name, llm.systemPrompt, ctx, body.summary) },
    ...history,
  ];

  let upstream: Response;
  try {
    upstream = await fetch(`${llm.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${llm.apiKey}`,
      },
      body: JSON.stringify({ model: llm.model, messages, stream: true }),
      signal: request.signal,
    });
  } catch (err) {
    return Response.json({ error: `Could not reach ${llm.baseUrl}: ${(err as Error).message}` }, { status: 502 });
  }

  const encoder = new TextEncoder();

  if (!upstream.ok || !upstream.body) {
    const detail = (await upstream.text().catch(() => "")).slice(0, 500);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "error", message: `${llm.name} API error ${upstream.status}: ${detail || upstream.statusText}` })}\n\n`,
          ),
        );
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`));
        controller.close();
      },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      let buffer = "";
      try {
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
                choices?: { delta?: { content?: string }; finish_reason?: string }[];
                usage?: { prompt_tokens?: number; completion_tokens?: number };
                error?: { message?: string };
              };
              if (json.error?.message) send({ type: "error", message: json.error.message });
              const delta = json.choices?.[0]?.delta?.content;
              if (delta) send({ type: "delta", text: delta });
              if (json.usage) send({ type: "usage", ...json.usage });
            } catch {
              /* ignore malformed upstream frame */
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") send({ type: "error", message: (err as Error).message });
      }
      send({ type: "done" });
      controller.close();
    },
    cancel() {
      reader.cancel().catch(() => {});
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
