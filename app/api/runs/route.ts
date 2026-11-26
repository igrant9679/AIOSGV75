import os from "os";
import { commandRun, createRun, listRuns, readRun, type RunCommand } from "@/lib/runs";
import { resolveApproval } from "@/lib/approvals";
import { vaultAvailable } from "@/lib/vault";
import { workerRecord } from "@/lib/runLessons";

export const dynamic = "force-dynamic";

/** GET → every project run in the vault, newest first, which machine this is, and each worker's record over them. */
export async function GET() {
  if (!(await vaultAvailable())) return Response.json({ error: "vault not reachable" }, { status: 503 });
  const runs = await listRuns();
  return Response.json({ host: os.hostname(), runs, record: workerRecord(runs) });
}

/**
 * POST { action: "create", brief, title?, host?, folder?, project?, planner?, allowEdit?, spread?, branch? }
 *      { action: "approve" | "reject", id }      answers the plan's approval (any machine)
 *      { action: "pause" | "resume" | "stop", id }  asks the run's driver to do it
 *
 * Nothing here advances a run: that is the driver machine's tick (lib/runs.ts).
 */
export async function POST(request: Request) {
  let b: { action?: string; id?: string; brief?: string; title?: string; host?: string; folder?: string; project?: string; planner?: string; allowEdit?: boolean; spread?: boolean; branch?: boolean };
  try {
    b = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (!(await vaultAvailable())) return Response.json({ error: "vault not reachable" }, { status: 503 });
  try {
    switch (b.action) {
      case "create": {
        const run = await createRun({
          brief: String(b.brief ?? ""),
          title: typeof b.title === "string" ? b.title : undefined,
          host: typeof b.host === "string" && b.host ? b.host : undefined,
          folder: typeof b.folder === "string" && b.folder ? b.folder : undefined,
          project: typeof b.project === "string" ? b.project : undefined,
          planner: typeof b.planner === "string" ? b.planner : undefined,
          allowEdit: b.allowEdit === true,
          spread: b.spread === true,
          branch: b.branch !== false,
        });
        return Response.json({ ok: true, run });
      }
      case "approve":
      case "reject": {
        const run = await readRun(String(b.id ?? ""));
        if (!run) return Response.json({ error: "That run isn't in the vault." }, { status: 404 });
        if (run.status !== "awaiting_approval" || !run.approvalId) return Response.json({ error: "This run isn't waiting for an approval." }, { status: 400 });
        const a = await resolveApproval(run.approvalId, b.action === "approve", `you (${os.hostname()})`);
        if (!a) return Response.json({ error: "The approval is no longer in the queue." }, { status: 404 });
        return Response.json({ ok: true, status: a.status });
      }
      case "pause":
      case "resume":
      case "stop": {
        await commandRun(String(b.id ?? ""), b.action as RunCommand, `you (${os.hostname()})`);
        return Response.json({ ok: true });
      }
      default:
        return Response.json({ error: "unknown action" }, { status: 400 });
    }
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
