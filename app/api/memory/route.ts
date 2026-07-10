import { readMemory, writeMemory, appendMemory, vaultAvailable } from "@/lib/vault";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await vaultAvailable())) return Response.json({ error: "vault not reachable" }, { status: 503 });
  return Response.json({ content: await readMemory() });
}

export async function PUT(request: Request) {
  const body = (await request.json()) as { content?: string };
  const content = (body.content ?? "").toString();
  if (content.length > 500_000) return Response.json({ error: "too large" }, { status: 413 });
  if (!(await vaultAvailable())) return Response.json({ error: "vault not reachable" }, { status: 503 });
  await writeMemory(content);
  return Response.json({ ok: true });
}

export async function POST(request: Request) {
  const body = (await request.json()) as { entry?: string; source?: string };
  const entry = (body.entry ?? "").toString().trim();
  if (!entry) return Response.json({ error: "entry required" }, { status: 400 });
  if (entry.length > 2000) return Response.json({ error: "too large" }, { status: 413 });
  if (!(await vaultAvailable())) return Response.json({ error: "vault not reachable" }, { status: 503 });
  await appendMemory(entry, (body.source ?? "agent").toString().slice(0, 30));
  return Response.json({ ok: true });
}
