import { startDraft, listContent, deleteContent, generateHero, publishContent, contentAvailable } from "@/lib/content";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET() {
  return Response.json({ items: await listContent(), vaultOk: await contentAvailable() });
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    action?: string;
    keyword?: string;
    agent?: string;
    id?: string;
    status?: "draft" | "publish";
    target?: "wordpress" | "ghost" | "webflow";
  };
  try {
    if (body.action === "draft") {
      const keyword = (body.keyword ?? "").trim();
      if (!keyword) return Response.json({ error: "keyword is required" }, { status: 400 });
      const item = await startDraft(keyword, body.agent || "claude");
      return Response.json({ ok: true, item });
    }
    if (body.action === "hero") {
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      const item = await generateHero(body.id);
      return Response.json({ ok: true, item });
    }
    if (body.action === "publish") {
      if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
      const item = await publishContent(body.id, body.status || "draft", body.target || "wordpress");
      return Response.json({ ok: true, item });
    }
    return Response.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });
  await deleteContent(id);
  return Response.json({ ok: true });
}
