import { readHermesChain, writeHermesChain, listNousModels, type HermesChainEntry } from "@/lib/hermesConfig";

export const dynamic = "force-dynamic";

export async function GET() {
  const [chain, models] = await Promise.all([readHermesChain(), listNousModels()]);
  return Response.json({ ...chain, models });
}

export async function POST(request: Request) {
  const body = (await request.json()) as { primary?: string; fallbacks?: HermesChainEntry[] };
  const primary = (body.primary ?? "").trim();
  if (!primary) return Response.json({ error: "primary model is required" }, { status: 400 });

  const fallbacks = (body.fallbacks ?? [])
    .filter((f) => f && typeof f.model === "string" && f.model.trim())
    .map((f) => ({ provider: (f.provider || "nous").trim(), model: f.model.trim() }))
    // a fallback identical to the primary is a no-op that just looks broken in the UI
    .filter((f) => f.model !== primary);

  const result = await writeHermesChain(primary, fallbacks);
  if (!result.ok) return Response.json({ error: result.error }, { status: 500 });
  return Response.json({ ok: true, ...result.chain });
}
