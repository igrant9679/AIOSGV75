import { serviceStatus, setServiceKey, serviceById } from "@/lib/services";

export const dynamic = "force-dynamic";

/** GET — catalog + redacted readiness (never the keys themselves). */
export async function GET() {
  return Response.json({ services: await serviceStatus() });
}

/** POST { id, apiKey } — set a key (non-empty) or clear the stored one (empty). */
export async function POST(request: Request) {
  const body = (await request.json()) as { id?: string; apiKey?: string };
  const id = (body.id ?? "").trim();
  if (!serviceById(id)) return Response.json({ error: "unknown service" }, { status: 400 });
  await setServiceKey(id, String(body.apiKey ?? ""));
  return Response.json({ ok: true });
}

/** DELETE ?id= — clear a stored key (env fallback, if any, remains). */
export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!serviceById(id)) return Response.json({ error: "unknown service" }, { status: 400 });
  await setServiceKey(id, "");
  return Response.json({ ok: true });
}
