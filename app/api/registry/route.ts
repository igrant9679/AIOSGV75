import {
  readRegistry,
  writeRegistry,
  slugify,
  uniqueId,
  ACCENT_IDS,
  WORKSPACE_RE,
  type LlmConfig,
  type CommandAgentConfig,
} from "@/lib/registry";
import type { Accent } from "@/lib/accents";

export const dynamic = "force-dynamic";

function safeAccent(a: unknown): Accent {
  return ACCENT_IDS.includes(a as (typeof ACCENT_IDS)[number]) ? (a as Accent) : "cyan";
}

/** Redact API keys before anything leaves the server. */
function redact(reg: Awaited<ReturnType<typeof readRegistry>>) {
  return {
    llms: reg.llms.map(({ apiKey, ...rest }) => ({ ...rest, hasKey: Boolean(apiKey) })),
    commandAgents: reg.commandAgents,
    workspaces: reg.workspaces,
  };
}

export async function GET() {
  return Response.json(redact(await readRegistry()));
}

export async function POST(request: Request) {
  const body = (await request.json()) as { kind?: string; data?: Record<string, unknown> };
  const reg = await readRegistry();
  const data = body.data ?? {};
  const taken = new Set([...reg.llms.map((l) => l.id), ...reg.commandAgents.map((a) => a.id)]);

  if (body.kind === "llm") {
    const name = String(data.name ?? "").trim();
    const baseUrl = String(data.baseUrl ?? "").trim().replace(/\/+$/, "");
    const model = String(data.model ?? "").trim();
    if (!name || !model) return Response.json({ error: "name and model are required" }, { status: 400 });
    if (!/^https:\/\/.+/i.test(baseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)/i.test(baseUrl)) {
      return Response.json({ error: "baseUrl must be https:// (or http://localhost)" }, { status: 400 });
    }
    const llm: LlmConfig = {
      id: uniqueId(slugify(name), taken),
      name: name.slice(0, 40),
      provider: String(data.provider ?? "custom").slice(0, 30),
      baseUrl,
      model: model.slice(0, 100),
      apiKey: String(data.apiKey ?? ""),
      accent: safeAccent(data.accent),
      systemPrompt: String(data.systemPrompt ?? "").slice(0, 4000) || undefined,
    };
    reg.llms.push(llm);
    await writeRegistry(reg);
    return Response.json({ ok: true, id: llm.id });
  }

  if (body.kind === "command") {
    const name = String(data.name ?? "").trim();
    const commandTemplate = String(data.commandTemplate ?? "").trim();
    if (!name || !commandTemplate) {
      return Response.json({ error: "name and commandTemplate are required" }, { status: 400 });
    }
    const agent: CommandAgentConfig = {
      id: uniqueId(slugify(name), taken),
      name: name.slice(0, 40),
      tagline: String(data.tagline ?? "Custom command agent").slice(0, 80),
      accent: safeAccent(data.accent),
      binary: commandTemplate.split(/\s+/)[0],
      commandTemplate: commandTemplate.slice(0, 500),
    };
    reg.commandAgents.push(agent);
    await writeRegistry(reg);
    return Response.json({ ok: true, id: agent.id });
  }

  if (body.kind === "workspace") {
    const name = String(data.name ?? "").trim();
    if (!WORKSPACE_RE.test(name)) {
      return Response.json({ error: "workspace name: letters, numbers, spaces, - _ (max 40)" }, { status: 400 });
    }
    if (!reg.workspaces.includes(name)) {
      reg.workspaces.push(name);
      await writeRegistry(reg);
    }
    return Response.json({ ok: true, id: name });
  }

  return Response.json({ error: "unknown kind" }, { status: 400 });
}

export async function PATCH(request: Request) {
  const body = (await request.json()) as { kind?: string; id?: string; data?: Record<string, unknown> };
  const reg = await readRegistry();

  if (body.kind === "llm") {
    const llm = reg.llms.find((l) => l.id === body.id);
    if (!llm) return Response.json({ error: "not found" }, { status: 404 });
    const d = body.data ?? {};
    if (typeof d.apiKey === "string" && d.apiKey) llm.apiKey = d.apiKey;
    if (typeof d.model === "string" && d.model.trim()) llm.model = d.model.trim().slice(0, 100);
    if (typeof d.systemPrompt === "string") llm.systemPrompt = d.systemPrompt.slice(0, 4000) || undefined;
    await writeRegistry(reg);
    return Response.json({ ok: true });
  }

  return Response.json({ error: "unknown kind" }, { status: 400 });
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind");
  const id = url.searchParams.get("id");
  const reg = await readRegistry();

  if (kind === "llm") reg.llms = reg.llms.filter((l) => l.id !== id);
  else if (kind === "command") reg.commandAgents = reg.commandAgents.filter((a) => a.id !== id);
  else if (kind === "workspace") {
    if (id === "Default") return Response.json({ error: "cannot delete Default" }, { status: 400 });
    reg.workspaces = reg.workspaces.filter((w) => w !== id);
  } else return Response.json({ error: "unknown kind" }, { status: 400 });

  await writeRegistry(reg);
  return Response.json({ ok: true });
}
