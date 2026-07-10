import { readUsage, recordUsage, type UsageEntry } from "@/lib/usage";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const days = Number(new URL(request.url).searchParams.get("days") ?? 30);
  return Response.json({ entries: await readUsage(Math.min(365, Math.max(1, days))) });
}

/** Client-side chat runs report themselves here; server runs record directly. */
export async function POST(request: Request) {
  const body = (await request.json()) as Partial<UsageEntry>;
  if (!body.agent || typeof body.ms !== "number") {
    return Response.json({ error: "agent and ms required" }, { status: 400 });
  }
  await recordUsage({
    ts: Date.now(),
    agent: String(body.agent).slice(0, 40),
    kind: body.kind === "mission" || body.kind === "system" ? body.kind : "chat",
    ms: Math.max(0, body.ms),
    costUsd: typeof body.costUsd === "number" ? body.costUsd : undefined,
    tokensIn: typeof body.tokensIn === "number" ? body.tokensIn : undefined,
    tokensOut: typeof body.tokensOut === "number" ? body.tokensOut : undefined,
    ok: body.ok !== false,
  });
  return Response.json({ ok: true });
}
