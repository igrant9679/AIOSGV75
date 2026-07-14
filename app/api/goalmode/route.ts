import { listGoalRuns, startGoalRun, stopGoalRun, goalArtifacts } from "@/lib/goalmode";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("artifacts");
  if (id) return Response.json({ artifacts: await goalArtifacts(id) });
  return Response.json({ runs: await listGoalRuns() });
}

export async function POST(request: Request) {
  const body = (await request.json()) as { goal?: string; maxTurns?: number };
  const goal = (body.goal ?? "").toString().trim();
  if (!goal) return Response.json({ error: "goal is required" }, { status: 400 });
  const maxTurns = Math.min(200, Math.max(5, Math.floor(body.maxTurns ?? 50)));
  const running = (await listGoalRuns()).filter((g) => g.status === "running");
  if (running.length >= 2) return Response.json({ error: "two goals already running" }, { status: 429 });
  const run = await startGoalRun(goal, maxTurns);
  return Response.json({ ok: true, id: run.id });
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });
  const ok = await stopGoalRun(id);
  return Response.json(ok ? { ok: true } : { error: "not found" }, { status: ok ? 200 : 404 });
}
