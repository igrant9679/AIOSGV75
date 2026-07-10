import { getEvalData, addCase, deleteCase, startEvalRun } from "@/lib/evals";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await getEvalData());
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    run?: { agentIds?: string[]; caseIds?: string[] };
    addCase?: { name?: string; prompt?: string; criteria?: string };
  };

  if (body.run) {
    const agentIds = (body.run.agentIds ?? []).filter((a) => typeof a === "string").slice(0, 6);
    if (agentIds.length === 0) return Response.json({ error: "pick at least one agent" }, { status: 400 });
    const run = await startEvalRun(agentIds, body.run.caseIds);
    return Response.json({ ok: true, id: run.id });
  }

  if (body.addCase) {
    const { name, prompt, criteria } = body.addCase;
    if (!name?.trim() || !prompt?.trim() || !criteria?.trim()) {
      return Response.json({ error: "name, prompt, and criteria are required" }, { status: 400 });
    }
    await addCase({ name, prompt, criteria });
    return Response.json({ ok: true });
  }

  return Response.json({ error: "nothing to do" }, { status: 400 });
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("caseId");
  if (!id) return Response.json({ error: "caseId required" }, { status: 400 });
  await deleteCase(id);
  return Response.json({ ok: true });
}
