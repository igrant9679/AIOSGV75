import { readGoals, writeGoals, vaultAvailable, type GoalTask } from "@/lib/vault";
import { WORKSPACE_RE } from "@/lib/registry";

export const dynamic = "force-dynamic";

function wsParam(value: string | null | undefined): string | undefined {
  if (!value || value === "Default") return undefined;
  return WORKSPACE_RE.test(value) ? value : undefined;
}

export async function GET(request: Request) {
  if (!(await vaultAvailable())) return Response.json({ error: "vault not reachable" }, { status: 503 });
  const ws = wsParam(new URL(request.url).searchParams.get("workspace"));
  return Response.json({ tasks: await readGoals(ws) });
}

export async function PUT(request: Request) {
  const body = (await request.json()) as { tasks?: GoalTask[]; workspace?: string };
  if (!Array.isArray(body.tasks)) return Response.json({ error: "tasks required" }, { status: 400 });
  if (!(await vaultAvailable())) return Response.json({ error: "vault not reachable" }, { status: 503 });

  const tasks = body.tasks
    .filter((t) => t && typeof t.text === "string" && t.text.trim())
    .map((t) => ({ text: t.text.trim().slice(0, 500), done: Boolean(t.done) }))
    .slice(0, 500);
  await writeGoals(tasks, wsParam(body.workspace));
  return Response.json({ ok: true });
}
