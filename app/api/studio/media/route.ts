import { readStudioMedia } from "@/lib/studio";

export const dynamic = "force-dynamic";

/** Serve a finished Studio asset's bytes from the vault (path-escape guarded). */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return new Response("id required", { status: 400 });
  const media = await readStudioMedia(id);
  if (!media) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(media.bytes), {
    headers: {
      "Content-Type": media.mime,
      "Content-Length": String(media.bytes.byteLength),
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
