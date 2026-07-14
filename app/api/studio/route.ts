import {
  listStudio,
  generateImage,
  generateVoice,
  startVideo,
  deleteStudioItem,
  studioAvailable,
} from "@/lib/studio";

export const dynamic = "force-dynamic";
// Image/voice calls to the provider can take 30–60s; give the route room.
export const maxDuration = 120;

export async function GET() {
  return Response.json({ items: await listStudio(), vaultOk: await studioAvailable() });
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    kind?: string;
    provider?: string;
    model?: string;
    prompt?: string;
    text?: string;
    size?: string;
    quality?: string;
    voice?: string;
  };
  const kind = body.kind;

  try {
    if (kind === "image") {
      const prompt = (body.prompt ?? "").trim();
      if (!prompt) return Response.json({ error: "prompt is required" }, { status: 400 });
      const item = await generateImage({ prompt, provider: body.provider, model: body.model, size: body.size, quality: body.quality });
      return Response.json({ ok: item.status !== "error", item, error: item.error });
    }
    if (kind === "voice") {
      const text = (body.text ?? "").trim();
      if (!text) return Response.json({ error: "text is required" }, { status: 400 });
      const item = await generateVoice({ text, provider: body.provider, model: body.model, voice: body.voice });
      return Response.json({ ok: item.status !== "error", item, error: item.error });
    }
    if (kind === "video") {
      const prompt = (body.prompt ?? "").trim();
      if (!prompt) return Response.json({ error: "prompt is required" }, { status: 400 });
      const item = await startVideo({ prompt, provider: body.provider, model: body.model });
      return Response.json({ ok: item.status !== "error", item, error: item.error });
    }
    return Response.json({ error: "unknown kind" }, { status: 400 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });
  await deleteStudioItem(id);
  return Response.json({ ok: true });
}
