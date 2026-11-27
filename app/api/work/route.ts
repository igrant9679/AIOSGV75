import { autoAssign, placesForPage, readTasks, readWorkSettings, saveWorkSettings, smartAssign, startAllAssigned, startTask, syncTasksFromReport, updateTask, type Assignee, type TaskStatus } from "@/lib/repoTasks";
import { readTeam } from "@/lib/team";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Work (lib/repoTasks.ts): the tasks the repositories mention, assigned to the owner or the fleet.
 * GET                                         → { tasks, settings, places: { repo: Place[] }, teammates }
 * POST { action: "sync" }                     bring in the latest GitHub report's tasks
 * POST { action: "auto-assign" }              assign open tasks by rules
 * POST { action: "smart-assign" }             ask Claude (no tools) about the unclear ones
 * POST { action: "update", id, assignee?, status?, access?, notes? }
 * POST { action: "start", id } | { action: "start-all" }
 * POST { action: "settings", autoAssign?, autoStart? }
 */
export async function GET() {
  try {
    const [tasks, settings, places, team] = await Promise.all([readTasks(), readWorkSettings(), placesForPage(), readTeam()]);
    return Response.json({ tasks, settings, places, teammates: team.members.map((m) => ({ id: m.id, name: m.name, host: m.hostLabel, folder: m.folder })) });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

const STATUSES: TaskStatus[] = ["inbox", "todo", "doing", "review", "done", "dismissed"];

export async function POST(req: Request) {
  let b: { action?: string; id?: string; assignee?: Assignee; status?: string; access?: string; notes?: string; autoAssign?: boolean; autoStart?: boolean };
  try {
    b = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  try {
    switch (b.action) {
      case "sync":
        return Response.json(await syncTasksFromReport());
      case "auto-assign":
        return Response.json(await autoAssign());
      case "smart-assign":
        return Response.json(await smartAssign());
      case "update": {
        if (!b.id) throw new Error("Which task?");
        const assignee = b.assignee && ["none", "me", "teammate", "machine"].includes(b.assignee.kind) ? b.assignee : undefined;
        const status = STATUSES.includes(b.status as TaskStatus) ? (b.status as TaskStatus) : undefined;
        const access = b.access === "edit" || b.access === "answer" ? b.access : undefined;
        return Response.json({ task: await updateTask(b.id, { assignee, status, access, notes: typeof b.notes === "string" ? b.notes : undefined }) });
      }
      case "start":
        if (!b.id) throw new Error("Which task?");
        return Response.json({ task: await startTask(b.id) });
      case "start-all":
        return Response.json(await startAllAssigned());
      case "settings":
        return Response.json({ settings: await saveWorkSettings({ autoAssign: b.autoAssign, autoStart: b.autoStart }) });
      default:
        return Response.json({ error: "unknown action" }, { status: 400 });
    }
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
