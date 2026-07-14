import { listChats, getChat, createChat, postMessage, deleteChat } from "@/lib/mastermind";
import { readRegistry } from "@/lib/registry";
import { AGENT_DEFS } from "@/lib/agents-config";

export const dynamic = "force-dynamic";

async function knownAgents(): Promise<{ ids: Set<string>; names: Record<string, string> }> {
  const reg = await readRegistry();
  const names: Record<string, string> = { claude: "Claude", auto: "Auto" };
  for (const d of AGENT_DEFS) names[d.id] = d.id.charAt(0).toUpperCase() + d.id.slice(1);
  for (const l of reg.llms) names[l.id] = l.name;
  for (const c of reg.commandAgents) names[c.id] = c.name;
  return { ids: new Set(Object.keys(names)), names };
}

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (id) {
    const chat = await getChat(id);
    return chat ? Response.json({ chat }) : Response.json({ error: "not found" }, { status: 404 });
  }
  const chats = await listChats();
  return Response.json({
    chats: chats.map(({ turns, ...meta }) => ({ ...meta, turnCount: turns.length })),
  });
}

export async function POST(request: Request) {
  const body = (await request.json()) as { chatId?: string; message?: string; roomIds?: string[] };
  const { ids, names } = await knownAgents();

  if (!body.chatId) {
    // new chat: validate the room
    const roomIds = (body.roomIds ?? []).filter((r) => ids.has(r) && r !== "auto").slice(0, 8);
    if (roomIds.length < 2) return Response.json({ error: "a mastermind needs at least 2 agents in the room" }, { status: 400 });
    const chat = await createChat(roomIds);
    if (body.message?.trim()) await postMessage(chat.id, body.message.trim(), names);
    return Response.json({ ok: true, id: chat.id });
  }

  const message = (body.message ?? "").toString().trim();
  if (!message) return Response.json({ error: "message required" }, { status: 400 });
  const chat = await postMessage(body.chatId, message, names);
  if (!chat) return Response.json({ error: "chat not found" }, { status: 404 });
  if (chat.status === "running" && chat.turns[chat.turns.length - 1]?.role !== "user") {
    return Response.json({ error: "round already in progress" }, { status: 429 });
  }
  return Response.json({ ok: true, id: chat.id });
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });
  await deleteChat(id);
  return Response.json({ ok: true });
}
