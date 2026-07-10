import { findLlm } from "@/lib/registry";
import { runLlmText, runClaudeText } from "@/lib/runners";

export const dynamic = "force-dynamic";

/**
 * Session compaction: folds older chat messages into a rolling summary so
 * long LLM conversations don't grow context without bound. Uses the chat's
 * own model when it has a working key, falling back to the local Claude CLI.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as {
    agentId?: string;
    previousSummary?: string;
    messages?: { role: string; content: string }[];
  };

  const messages = (body.messages ?? [])
    .filter((m) => typeof m.content === "string" && (m.role === "user" || m.role === "assistant"))
    .slice(0, 40)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));
  if (messages.length === 0) return Response.json({ error: "messages required" }, { status: 400 });

  const prompt = [
    `Condense the following conversation segment into a compact summary (max 200 words).`,
    `Preserve concrete facts, names, numbers, decisions, preferences, and open questions. No preamble — output only the summary.`,
    body.previousSummary?.trim() ? `Merge seamlessly with this existing summary of even earlier conversation:\n${body.previousSummary.trim()}` : "",
    ``,
    `CONVERSATION SEGMENT:`,
    ...messages.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`),
  ]
    .filter(Boolean)
    .join("\n");

  const llm = body.agentId ? await findLlm(body.agentId) : undefined;
  let result = llm
    ? await runLlmText(llm, prompt, "You are a precise conversation summarizer.")
    : { text: "", ms: 0, error: "no llm" };
  if (result.error || !result.text.trim()) {
    result = await runClaudeText(prompt);
  }
  if (result.error || !result.text.trim()) {
    return Response.json({ error: result.error ?? "summarizer produced no output" }, { status: 502 });
  }
  return Response.json({ summary: result.text.trim().slice(0, 4000) });
}
