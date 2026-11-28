import { autoAssign, placesForPage, readTasks, readWorkSettings, saveWorkSettings, smartAssign, startAllAssigned, startTask, syncTasksFromReport, updateTask, type Assignee, type TaskStatus } from "@/lib/repoTasks";
import { readTeam } from "@/lib/team";
import { approveLevelupTask, connectLevelup, disconnectLevelup, levelupForPage, levelupTick, saveAreas } from "@/lib/levelup";
import os from "os";
import { readConfig } from "@/lib/cluster";
import { isWorkHome, packWork, readWorkHome, writeWorkHome } from "@/lib/workHome";

/**
 * Work lives on ONE machine, the Work home (lib/workHome.ts, rule 48). Anywhere else this route is answered
 * by the home over the LAN; a request the home itself forwards (x-mc-work-proxied) is always answered here.
 */
async function viaHome(req: Request, method: "GET" | "POST", body?: unknown): Promise<Response | null> {
  if (req.headers.get("x-mc-work-proxied") === "1" || isWorkHome()) return null;
  if (method === "POST" && (body as { action?: string })?.action === "move-home") return null; // handled below
  const home = readWorkHome()!;
  try {
    const { peerFetch } = await import("@/lib/peer");
    const data = await peerFetch<Record<string, unknown>>(home.host, "/peer/work", method === "GET" ? { timeoutMs: 30_000 } : { body, timeoutMs: 115_000 });
    return Response.json(method === "GET" ? { ...data, home: { host: home.host, label: home.label, here: false } } : data);
  } catch (e) {
    return Response.json({ error: `Work lives on ${home.label}, which can't be reached right now (${(e as Error).message}).`, home: { host: home.host, label: home.label, here: false, unreachable: true } }, { status: method === "GET" ? 200 : 502 });
  }
}

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
 * LevelUp (lib/levelup.ts, rule 46):
 * POST { action: "levelup-connect", url, key } | { action: "levelup-disconnect" } | { action: "levelup-sync" }
 * POST { action: "approve", id }               a LevelUp hand-off: approve it here
 * POST { action: "area-repo", repo, area } | { action: "area-folder", area, place } | { action: "area-clients", clients }
 */
export async function GET(req: Request) {
  try {
    const forwarded = await viaHome(req, "GET");
    if (forwarded) return forwarded;
    const wh = readWorkHome();
    const [tasks, settings, places, team, levelup] = await Promise.all([readTasks(), readWorkSettings(), placesForPage(), readTeam(), levelupForPage()]);
    // the prompt (brief) stays out of the page: it is the owner's own LevelUp text and only the worker needs it
    return Response.json({ tasks: tasks.map(({ brief: _b, ...t }) => t), settings, places, teammates: team.members.map((m) => ({ id: m.id, name: m.name, host: m.hostLabel, folder: m.folder })), levelup, home: wh ? { host: wh.host, label: wh.label, here: wh.host === os.hostname() } : null });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

const STATUSES: TaskStatus[] = ["inbox", "todo", "doing", "review", "done", "dismissed"];

export async function POST(req: Request) {
  let b: { action?: string; id?: string; assignee?: Assignee; status?: string; access?: string; notes?: string; autoAssign?: boolean; autoStart?: boolean; url?: string; key?: string; repo?: string; area?: string | null; place?: { host: string; hostLabel: string; folder: string; tool: string; agent?: string; agentLabel?: string } | null; clients?: string[] };
  try {
    b = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  const forwarded = await viaHome(req, "POST", b);
  if (forwarded) return forwarded;
  try {
    switch (b.action) {
      case "move-home": {
        // make another machine (or this one) the Work home; this machine's Work goes with it
        const target = String((b as { host?: string }).host ?? "");
        if (!target) throw new Error("Which machine?");
        const { clusterStatus } = await import("@/lib/cluster");
        const st = await clusterStatus();
        const node = st.nodes.find((n) => n.host === target || n.label === target);
        if (!node) throw new Error(`No machine called ${target} in the fleet.`);
        const cfg = await readConfig().catch(() => null);
        const me = cfg?.label || os.hostname();
        let moved: { written: string[]; backup?: string } = { written: [] };
        if (node.host !== os.hostname()) {
          if (!isWorkHome()) throw new Error(`Move it from the machine that has Work now (${readWorkHome()?.label}).`);
          const { peerFetch } = await import("@/lib/peer");
          moved = await peerFetch(node.host, "/peer/work-import", { body: { files: await packWork() }, timeoutMs: 120_000 });
        }
        await writeWorkHome({ host: node.host, label: node.label ?? node.host, at: Date.now(), by: me });
        return Response.json({ ok: true, home: node.label ?? node.host, moved });
      }
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
      case "levelup-connect":
        if (!b.url || !b.key) throw new Error("Paste LevelUp's address and the key from LevelUp's Fleet panel.");
        return Response.json(await connectLevelup(b.url, b.key));
      case "levelup-disconnect":
        await disconnectLevelup();
        return Response.json({ ok: true });
      case "levelup-sync":
        await levelupTick();
        return Response.json({ ok: true });
      case "approve":
        if (!b.id) throw new Error("Which task?");
        await approveLevelupTask(b.id);
        return Response.json({ ok: true });
      case "area-repo":
        if (!b.repo) throw new Error("Which repository?");
        return Response.json({ areas: await saveAreas({ repo: { repo: b.repo, area: b.area ?? null } }) });
      case "area-folder":
        if (!b.area) throw new Error("Which area?");
        return Response.json({ areas: await saveAreas({ folder: { area: b.area, place: b.place && b.place.host && b.place.folder ? b.place : null } }) });
      case "area-clients":
        return Response.json({ areas: await saveAreas({ clients: Array.isArray(b.clients) ? b.clients : [] }) });
      default:
        return Response.json({ error: "unknown action" }, { status: 400 });
    }
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
