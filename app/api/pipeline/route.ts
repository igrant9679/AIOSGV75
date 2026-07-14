import { listItems, capture, approve, reject, remove } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ items: await listItems() });
}

export async function POST(request: Request) {
  const body = (await request.json()) as { input?: string };
  const input = (body.input ?? "").toString().trim();
  if (!input) return Response.json({ error: "input is required" }, { status: 400 });
  const item = await capture(input);
  return Response.json({ ok: true, id: item.id });
}

export async function PATCH(request: Request) {
  const body = (await request.json()) as { id?: string; action?: "approve" | "reject" };
  if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
  const item = body.action === "reject" ? await reject(body.id) : await approve(body.id);
  return item ? Response.json({ ok: true }) : Response.json({ error: "not found" }, { status: 404 });
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });
  await remove(id);
  return Response.json({ ok: true });
}
