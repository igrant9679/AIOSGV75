import { listOrchestrations, startOrchestration } from "@/lib/orchestrator";
import { readRegistry } from "@/lib/registry";
import { AGENT_DEFS } from "@/lib/agents-config";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ orchestrations: await listOrchestrations() });
}

export async function POST(request: Request) {
  const body = (await request.json()) as { goal?: string; workers?: string[] };
  const goal = (body.goal ?? "").toString().trim();
  if (!goal) return Response.json({ error: "goal is required" }, { status: 400 });
  if (goal.length > 4000) return Response.json({ error: "goal too long (4000 chars max)" }, { status: 400 });

  // pinned workers must be real agents; empty = auto routing
  const reg = await readRegistry();
  const known = new Set([
    "claude",
    ...AGENT_DEFS.map((d) => d.id),
    ...reg.commandAgents.map((a) => a.id),
    ...reg.llms.map((l) => l.id),
  ]);
  const workers = (body.workers ?? []).filter((id) => typeof id === "string" && known.has(id)).slice(0, 4);

  const running = (await listOrchestrations()).filter((o) => o.status !== "done" && o.status !== "error");
  if (running.length >= 2) {
    return Response.json({ error: "two orchestrations already running — let one finish first" }, { status: 429 });
  }
  const o = await startOrchestration(goal, workers);
  return Response.json({ ok: true, id: o.id });
}
