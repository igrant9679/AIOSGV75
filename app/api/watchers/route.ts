import { listWatchers, createWatcher, setWatcherEnabled, deleteWatcher, type WatcherType } from "@/lib/watchers";

export const dynamic = "force-dynamic";

const TYPES = new Set<WatcherType>(["file", "goal_done", "memory_mention"]);

export async function GET() {
  return Response.json({ watchers: await listWatchers() });
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    name?: string;
    type?: WatcherType;
    path?: string;
    keyword?: string;
    prompt?: string;
    agentId?: string;
    notify?: boolean;
    cooldownMin?: number;
  };
  if (!body.name?.trim()) return Response.json({ error: "name required" }, { status: 400 });
  if (!body.type || !TYPES.has(body.type)) return Response.json({ error: "bad type" }, { status: 400 });
  if (!body.prompt?.trim()) return Response.json({ error: "prompt required" }, { status: 400 });
  if (body.type === "file" && !body.path?.trim()) return Response.json({ error: "file watcher needs a folder path" }, { status: 400 });

  const watcher = await createWatcher({
    name: body.name,
    type: body.type,
    config: { path: body.path?.trim(), keyword: body.keyword?.trim() },
    prompt: body.prompt,
    agentId: (body.agentId ?? "auto").toString(),
    notify: body.notify !== false,
    cooldownMin: body.cooldownMin,
  });
  return Response.json({ ok: true, id: watcher.id });
}

export async function PATCH(request: Request) {
  const body = (await request.json()) as { id?: string; enabled?: boolean };
  if (!body.id || typeof body.enabled !== "boolean") return Response.json({ error: "id and enabled required" }, { status: 400 });
  const ok = await setWatcherEnabled(body.id, body.enabled);
  return Response.json(ok ? { ok: true } : { error: "not found" }, { status: ok ? 200 : 404 });
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });
  await deleteWatcher(id);
  return Response.json({ ok: true });
}
