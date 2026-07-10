import { listMcpServers, addMcpServer, removeMcpServer, MCP_NAME_RE } from "@/lib/mcp";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ servers: await listMcpServers() });
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    name?: string;
    transport?: string;
    commandLine?: string;
    url?: string;
  };
  const name = (body.name ?? "").trim();
  if (!MCP_NAME_RE.test(name)) {
    return Response.json({ error: "name: letters, numbers, - _ (max 30)" }, { status: 400 });
  }
  if (body.transport === "http") {
    const url = (body.url ?? "").trim();
    if (!/^https?:\/\/.+/i.test(url)) return Response.json({ error: "valid url required" }, { status: 400 });
    await addMcpServer({ name, transport: "http", url });
  } else {
    const commandLine = (body.commandLine ?? "").trim();
    if (!commandLine) return Response.json({ error: "command is required" }, { status: 400 });
    await addMcpServer({ name, transport: "stdio", commandLine });
  }
  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  const name = new URL(request.url).searchParams.get("name");
  if (!name || !MCP_NAME_RE.test(name)) return Response.json({ error: "bad name" }, { status: 400 });
  await removeMcpServer(name);
  return Response.json({ ok: true });
}
