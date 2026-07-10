import { appendChatLog, vaultAvailable } from "@/lib/vault";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json()) as { agent?: string; markdown?: string };
  const markdown = (body.markdown ?? "").toString();
  if (!markdown.trim()) return Response.json({ error: "markdown required" }, { status: 400 });
  if (markdown.length > 500_000) return Response.json({ error: "too large" }, { status: 413 });
  if (!(await vaultAvailable())) return Response.json({ error: "vault not reachable" }, { status: 503 });

  const file = await appendChatLog(body.agent ?? "agent", markdown);
  return Response.json({ ok: true, file });
}
