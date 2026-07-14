import { listBuilds, startBuild, readBuildHtml, deleteBuild, buildsAvailable } from "@/lib/builds";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (id) {
    const html = await readBuildHtml(id);
    if (html === null) return Response.json({ error: "not found" }, { status: 404 });
    if (url.searchParams.get("raw") === "1") {
      return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    return Response.json({ html });
  }
  return Response.json({ builds: await listBuilds() });
}

export async function POST(request: Request) {
  if (!(await buildsAvailable())) return Response.json({ error: "vault not available" }, { status: 503 });
  const body = (await request.json()) as { prompt?: string; kind?: "game" | "app" };
  const prompt = (body.prompt ?? "").toString().trim();
  if (!prompt) return Response.json({ error: "prompt is required" }, { status: 400 });
  const kind = body.kind === "app" ? "app" : "game";
  const inFlight = (await listBuilds()).filter((b) => b.status === "building");
  if (inFlight.length >= 2) return Response.json({ error: "two builds already in progress" }, { status: 429 });
  const build = await startBuild(prompt, kind);
  return Response.json({ ok: true, id: build.id });
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });
  await deleteBuild(id);
  return Response.json({ ok: true });
}
