import { runAgentText } from "@/lib/runners";

export const dynamic = "force-dynamic";

interface Turn {
  role: "user" | "assistant";
  content: string;
}

/**
 * The Auto agent's chat endpoint: routes each message to the best real agent
 * (see lib/router.ts) and returns the answer with the routing decision.
 * Non-streaming — the router already spans engines with different transports.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as { prompt?: string; history?: Turn[] };
  const prompt = (body.prompt ?? "").toString().trim();
  if (!prompt) return Response.json({ error: "prompt is required" }, { status: 400 });

  const history = (body.history ?? [])
    .filter((t) => (t.role === "user" || t.role === "assistant") && typeof t.content === "string")
    .slice(-8);

  const transcript =
    history.length > 0
      ? `Previous conversation:\n${history.map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.content.slice(0, 1500)}`).join("\n")}\n\nUser's new message: ${prompt}\n\nReply to the new message as the assistant.`
      : prompt;

  const r = await runAgentText("auto", transcript);
  return Response.json({
    text: r.text,
    ms: r.ms,
    error: r.error,
    routedTo: r.routedTo,
    reason: r.routeReason,
  });
}
