/**
 * LevelUp ↔ Fleet, the decisions (pure: no files, no network; tested by scripts/test-levelup.mjs).
 *
 * LevelUp (the owner's planning app) keeps each hand-off with a state; Mission Control moves it on:
 *   requested → (we) propose a plan → (owner) approve → (we) start → (we) finish → (owner) accept / send back
 * The contract, and the same rules on LevelUp's side, are in the LevelUp repository:
 * server/_core/fleet.ts. Nothing starts before the owner approves (in LevelUp, or here in Work).
 */

export type LuState = "requested" | "proposed" | "approved" | "running" | "review" | "done" | "failed" | "cancelled";
export interface LuArea { type: "client" | "personal"; name: string; goalId?: string | null; goalTitle?: string | null }
export interface LuItem {
  id: number;
  status: LuState;
  title: string;
  refType: string | null;
  refId: string | null;
  projectKey?: string;
  updatedAt?: string;
  data: {
    kind?: "task" | "project";
    instructions?: string;
    snapshot?: { title?: string; notes?: string; due?: string | null; projectName?: string; subtasks?: string[] };
    area?: LuArea | null;
    when?: string | null;
    access?: "edit" | "answer";
    proposal?: { summary: string; machine?: string; folder?: string; tool?: string; repo?: string | null } | null;
    claimedBy?: string | null;
    cancelAck?: boolean;
    result?: { text: string } | null;
    error?: string | null;
    updates?: { at: string; by: "owner" | "fleet"; text: string; state?: string }[];
  };
}

/** The owner's clients (Mission Control's default list; the areas file can add more). */
export const DEFAULT_CLIENTS = ["LSI Media", "CommunityForce", "MeYouSocial"];

/** A repository's area: the owner's own choice first, then an obvious name match, else none. */
export function areaOfRepo(repo: string, map: Record<string, string> = {}): string | null {
  const key = repo.toLowerCase();
  for (const [r, a] of Object.entries(map)) if (r.toLowerCase() === key && a) return a;
  const name = key.split("/")[1] ?? key;
  if (/communityforce/.test(name)) return "CommunityForce";
  if (/meyousocial|(^|[-_])mys([-_]|$)/.test(name)) return "MeYouSocial";
  if (/(^|[-_])lsi([-_]|$)|lsi-?media/.test(name)) return "LSI Media";
  if (name === "mission-control") return "Personal";
  return null;
}

/** A repository the text names: "owner/name" anywhere, or a repository's own name as a whole word (4+ letters). */
export function repoMentioned(text: string, repos: string[]): string | null {
  const t = ` ${text.toLowerCase()} `;
  const full = repos.find((r) => t.includes(r.toLowerCase()));
  if (full) return full;
  const hits = repos.filter((r) => {
    const n = (r.split("/")[1] ?? "").toLowerCase();
    return n.length >= 4 && new RegExp(`[^a-z0-9-]${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^a-z0-9-]`).test(t);
  });
  return hits.length === 1 ? hits[0] : null;
}

export interface PlanPlace { key: string; label: string; host: string; hostLabel: string; folder: string; tool?: string; agent?: string; agentLabel?: string; kind: "teammate" | "machine"; teammateId?: string; edit: boolean; local: boolean; lan: boolean }
export interface Plan {
  place: PlanPlace | null;
  /** null = this machine's home folder (no folder chosen) */
  repo: string | null;
  access: "edit" | "answer";
  summary: string;
  why: string;
}

/**
 * Where a hand-off should run. In order: a repository the task names (its best place in the fleet), the
 * folder the owner set for the area, else this machine's home folder, ANSWER ONLY (with no folder chosen
 * it must not change files anywhere).
 */
export function planFor(item: LuItem, o: { repos: string[]; places: Record<string, PlanPlace[]>; areaPlaces: Record<string, PlanPlace>; pick: (ps: PlanPlace[]) => PlanPlace | null; myLabel: string }): Plan {
  const text = [item.title, item.data.instructions ?? "", item.data.snapshot?.notes ?? "", item.data.snapshot?.projectName ?? ""].join("\n");
  const wantEdit = item.data.access !== "answer";
  const areaName = item.data.area?.name ?? "";
  const repo = repoMentioned(text, o.repos);
  const kind = item.data.kind === "project" ? "the project" : "it";
  if (repo) {
    const best = o.pick(o.places[repo.toLowerCase()] ?? o.places[repo] ?? []);
    if (best) {
      const access = wantEdit && best.edit ? "edit" : "answer";
      return { place: best, repo, access, why: `it names ${repo}`, summary: `${best.label} works on ${kind} in ${repo} (${best.folder})${access === "edit" ? ", and may change files there" : ", answer only"}${wantEdit && !best.edit ? ` (that machine doesn't allow file changes)` : ""}.` };
    }
  }
  const ap = areaName ? o.areaPlaces[areaName] : undefined;
  if (ap) {
    const access = wantEdit && ap.edit ? "edit" : "answer";
    return { place: ap, repo: null, access, why: `the work folder set for ${areaName}`, summary: `${ap.label} works on ${kind} in the ${areaName} work folder (${ap.folder})${access === "edit" ? ", and may change files there" : ", answer only"}.` };
  }
  return {
    place: null,
    repo: null,
    access: "answer",
    why: areaName ? `no work folder is set for ${areaName}` : "no area or repository to place it by",
    summary: `Claude Code on ${o.myLabel} answers ${kind === "it" ? "it" : "the project"} in writing (no files changed)${wantEdit ? `: to let it change files, set a work folder for ${areaName || "this area"} in Mission Control → Work → Areas, or name the repository in the instructions` : ""}.`,
  };
}

/** The prompt the fleet worker gets for a LevelUp hand-off. Its text is the owner's own words. */
export function luPrompt(item: LuItem, access: "edit" | "answer", sentBack: string[] = []): string {
  const s = item.data.snapshot ?? {};
  const a = item.data.area;
  return [
    `A ${item.data.kind === "project" ? "project" : "task"} the owner handed to the fleet from LevelUp, their planning app${a ? `, for ${a.type === "client" ? `their client ${a.name}` : `a personal goal${a.goalTitle ? `: ${a.goalTitle}` : ""}`}` : ""}.`,
    `${item.data.kind === "project" ? "Project" : "Task"}: ${item.title}`,
    s.projectName ? `LevelUp project: ${s.projectName}` : "",
    s.due ? `Due: ${s.due}` : "",
    s.notes ? `Notes on the task:\n${s.notes}` : "",
    s.subtasks?.length ? `Its steps:\n${s.subtasks.map((x) => `- ${x}`).join("\n")}` : "",
    item.data.instructions ? `The owner's instructions:\n${item.data.instructions}` : "",
    sentBack.length ? `The owner reviewed an earlier result and sent it back:\n${sentBack.map((x) => `- ${x}`).join("\n")}\nDo what they asked, and give the whole corrected result (not only the changes).` : "",
    item.data.kind === "project" ? "Plan it into steps first, then carry them out one by one." : "",
    access === "edit" ? "You may change files in this folder to do it. Keep changes focused on this work." : "Don't change any files: do the work in writing and put the whole result in your reply.",
    "Finish with the result itself (what you made, where, and anything left for the owner to do or decide).",
  ].filter(Boolean).join("\n\n");
}

/** What the owner said when sending results back, since the last time it was approved. */
export function sentBackNotes(item: LuItem): string[] {
  return (item.data.updates ?? []).filter((u) => u.by === "owner" && /^Sent back: /.test(u.text)).map((u) => u.text.replace(/^Sent back: /, ""));
}

export type WorkLike = { status: "inbox" | "todo" | "doing" | "review" | "done" | "dismissed"; approval?: "waiting" | "approved"; result?: { text: string; error?: string }; job?: { id: string }; luApprovedPosted?: boolean; luRound?: number };
export type Step = "propose" | "approve" | "start" | "finish" | "fail" | "ack" | "done" | "mirror" | "none";

/**
 * What to do about one hand-off now. `task` is our Work copy (undefined = none yet), `today` YYYY-MM-DD.
 * Only the machine that claimed an item moves it on (LevelUp enforces it too).
 */
export function nextStep(item: LuItem, task: WorkLike | undefined, me: string, today: string): Step {
  const claimed = item.data.claimedBy;
  const mine = !claimed || claimed === me;
  switch (item.status) {
    case "requested":
      return mine ? "propose" : "none";
    case "proposed":
      if (claimed !== me) return "none";
      if (task?.approval === "approved") return "approve";
      return "none";
    case "approved":
      if (!mine) return "none";
      if (item.data.when && item.data.when > today) return "none";
      if (task?.status === "doing") return "none";
      return "start";
    case "running":
      if (claimed !== me) return "none";
      if (!task) return "fail";
      if (task.status === "review") return "finish";
      if (task.status === "todo" && task.result?.error) return "fail";
      if (task.status === "dismissed") return "fail";
      return "none";
    case "review":
      if (claimed !== me) return "none";
      return task?.status === "done" ? "done" : "none";
    case "cancelled":
      return item.data.cancelAck ? (task && task.status !== "dismissed" ? "mirror" : "none") : mine ? "ack" : "none";
    case "done":
    case "failed":
      return task && ((item.status === "done" && task.status !== "done") || (item.status === "failed" && task.status === "doing")) ? "mirror" : "none";
    default:
      return "none";
  }
}

export interface OutboxItem { id: string; title: string; detail?: string; kind: "yours" | "review" | "waiting"; area?: string | null; project?: string | null; due?: string | null; at?: string | null }
type OutTask = { id: string; repo: string; title: string; status: string; assignee: { kind: string }; source: { kind: string; label: string }; origin?: { kind: string }; priority: number; updatedAt: number };
/**
 * What Mission Control tells LevelUp is waiting on the owner: Work tasks assigned to them, and fleet
 * results waiting for review here. LevelUp's own hand-offs aren't repeated (LevelUp shows those itself).
 */
export function outboxFrom(tasks: OutTask[], areaMap: Record<string, string> = {}, max = 150): OutboxItem[] {
  const out: OutboxItem[] = [];
  const open = tasks.filter((t) => t.origin?.kind !== "levelup");
  for (const t of open.filter((x) => x.assignee.kind === "me" && (x.status === "todo" || x.status === "inbox")).sort((a, b) => a.priority - b.priority || b.updatedAt - a.updatedAt))
    out.push({ id: t.id, title: t.title, detail: t.source.label, kind: "yours", area: areaOfRepo(t.repo, areaMap), project: t.repo, at: new Date(t.updatedAt).toISOString() });
  for (const t of open.filter((x) => x.status === "review").sort((a, b) => b.updatedAt - a.updatedAt))
    out.push({ id: t.id, title: t.title, detail: "The fleet finished this: review it in Mission Control → Work", kind: "review", area: areaOfRepo(t.repo, areaMap), project: t.repo, at: new Date(t.updatedAt).toISOString() });
  return out.slice(0, max);
}
