import { listMissions, startMission, type MissionStrategy } from "@/lib/missions";
import { readRegistry } from "@/lib/registry";
import { AGENT_DEFS } from "@/lib/agents-config";

export const dynamic = "force-dynamic";

const STRATEGIES = new Set<MissionStrategy>(["single", "moa", "pipeline", "arena", "debate"]);

async function validAgentIds(): Promise<Set<string>> {
  const reg = await readRegistry();
  return new Set([
    "claude",
    "auto",
    ...AGENT_DEFS.map((d) => d.id),
    ...reg.commandAgents.map((a) => a.id),
    ...reg.llms.map((l) => l.id),
  ]);
}

export async function GET() {
  return Response.json({ missions: await listMissions() });
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    title?: string;
    prompt?: string;
    strategy?: MissionStrategy;
    agentIds?: string[];
    synthesizerId?: string;
  };

  const prompt = (body.prompt ?? "").toString().trim();
  if (!prompt) return Response.json({ error: "prompt is required" }, { status: 400 });
  if (!body.strategy || !STRATEGIES.has(body.strategy)) {
    return Response.json({ error: "strategy must be single | moa | pipeline" }, { status: 400 });
  }

  const known = await validAgentIds();
  const agentIds = (body.agentIds ?? []).filter((id) => known.has(id)).slice(0, 6);
  if (agentIds.length === 0) return Response.json({ error: "pick at least one valid agent" }, { status: 400 });
  if (body.strategy !== "single" && agentIds.length < 2) {
    return Response.json({ error: `${body.strategy} needs at least 2 agents` }, { status: 400 });
  }
  if (body.strategy === "arena" && agentIds.length > 4) {
    return Response.json({ error: "arena supports 2-4 agents" }, { status: 400 });
  }
  const synthesizerId = body.synthesizerId && known.has(body.synthesizerId) ? body.synthesizerId : undefined;
  if ((body.strategy === "moa" || body.strategy === "debate") && !synthesizerId) {
    return Response.json({ error: `${body.strategy} needs a ${body.strategy === "debate" ? "judge" : "synthesizer"} agent` }, { status: 400 });
  }

  const mission = await startMission({
    title: body.title,
    prompt,
    strategy: body.strategy,
    agentIds,
    synthesizerId,
  });
  return Response.json({ ok: true, id: mission.id });
}
