import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { readConfig } from "./cluster";
import { readTasks, mutateTasks, noteTask, startTask, fleetPlaces, assigneeLabel, type RepoTask, type Assignee, type Place } from "./repoTasks";
import { readGithubReport } from "./githubReport";
import { pickPlace } from "./repoTaskRules";
import { isPaused } from "./fleetPause";
import { startJob } from "./sessionActions";
import { planFor, luPrompt, sentBackNotes, nextStep, outboxFrom, areaOfRepo, DEFAULT_CLIENTS, type LuItem, type PlanPlace } from "./levelupRules";

/**
 * LevelUp ↔ Fleet (rule 46). LevelUp is the owner's planning app (a cloud service); from it they hand
 * tasks and projects to the fleet. Mission Control is never reachable from outside (127.0.0.1 only), so
 * IT calls LevelUp: every minute the scheduler's `levelupTick` reads the hand-offs, proposes a plan for
 * new ones, starts the ones the owner approved (as Work tasks, lib/repoTasks.ts), reports results, and
 * sends LevelUp the list of what is waiting on the owner here.
 *
 * Connection: data/levelup.json {url, key} on THIS machine only (the key is a credential: never shared,
 * logged or put in the vault). Connect on the machine whose Work page you use: Work's data is local.
 * Areas (which client each repository is for, and the work folder per area): data/areas.json.
 */

const DATA = path.join(process.cwd(), "data");
const CONFIG = path.join(DATA, "levelup.json");
const STATUS = path.join(DATA, "levelup-status.json");
const AREAS = path.join(DATA, "areas.json");
const me = () => os.hostname();

export interface LevelupConfig { url: string; key: string; connectedAt: number }
export interface LevelupStatus { ok: boolean; at: number; error?: string; items?: number; open?: number; outboxAt?: number; outboxCount?: number; workspace?: number }
export interface AreasFile {
  /** extra client names besides LSI Media, CommunityForce, MeYouSocial */
  clients: string[];
  /** repository (owner/name) → area name */
  repos: Record<string, string>;
  /** area name → the place its non-repository work runs (a folder the fleet already uses) */
  folders: Record<string, { host: string; hostLabel: string; folder: string; tool: string; agent?: string; agentLabel?: string }>;
}

// ─── files ───

export function readLevelupConfig(): LevelupConfig | null {
  try {
    const c = JSON.parse(fs.readFileSync(CONFIG, "utf8"));
    return c && typeof c.url === "string" && typeof c.key === "string" && c.key ? c : null;
  } catch {
    return null;
  }
}
export function readLevelupStatus(): LevelupStatus | null {
  try {
    return JSON.parse(fs.readFileSync(STATUS, "utf8"));
  } catch {
    return null;
  }
}
async function writeJson(file: string, v: unknown) {
  await fsp.mkdir(DATA, { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(v, null, 2), "utf8");
  await fsp.rename(tmp, file);
}
export function readAreas(): AreasFile {
  try {
    const a = JSON.parse(fs.readFileSync(AREAS, "utf8"));
    return { clients: Array.isArray(a.clients) ? a.clients.filter((x: unknown) => typeof x === "string") : [], repos: a.repos && typeof a.repos === "object" ? a.repos : {}, folders: a.folders && typeof a.folders === "object" ? a.folders : {} };
  } catch {
    return { clients: [], repos: {}, folders: {} };
  }
}
export async function saveAreas(patch: { clients?: string[]; repo?: { repo: string; area: string | null }; folder?: { area: string; place: AreasFile["folders"][string] | null } }): Promise<AreasFile> {
  const a = readAreas();
  if (patch.clients) a.clients = [...new Set(patch.clients.map((x) => String(x).trim().slice(0, 80)).filter(Boolean))].slice(0, 30);
  if (patch.repo) {
    const r = String(patch.repo.repo).slice(0, 200);
    if (patch.repo.area) a.repos[r] = String(patch.repo.area).slice(0, 80);
    else delete a.repos[r];
  }
  if (patch.folder) {
    const n = String(patch.folder.area).slice(0, 80);
    if (patch.folder.place) a.folders[n] = patch.folder.place;
    else delete a.folders[n];
  }
  await writeJson(AREAS, a);
  return a;
}
export function areaNames(): string[] {
  const a = readAreas();
  return [...new Set([...DEFAULT_CLIENTS, ...a.clients, "Personal"])];
}

/** Only https, except a LevelUp running on this computer (its local test copy). */
export function cleanUrl(u: string): string {
  let x: URL;
  try {
    x = new URL(String(u).trim());
  } catch {
    throw new Error("That isn't a web address (it should look like https://levelupnow.tools).");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(x.hostname);
  if (x.protocol !== "https:" && !(local && x.protocol === "http:")) throw new Error("LevelUp's address must start with https://");
  return `${x.protocol}//${x.host}`;
}

async function machineLabel(): Promise<string> {
  const cfg = await readConfig().catch(() => null);
  return cfg?.label || me();
}

// ─── talking to LevelUp ───

async function api<T>(cfg: LevelupConfig, method: string, p: string, body?: unknown): Promise<T> {
  const res = await fetch(`${cfg.url}/api/fleet/v1${p}`, {
    method,
    headers: { authorization: `Bearer ${cfg.key}`, "content-type": "application/json", "x-fleet-machine": await machineLabel() },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  let j: any = null;
  try {
    j = await res.json();
  } catch {
    /* not JSON */
  }
  if (!res.ok) throw new Error(`LevelUp said ${res.status}${j?.error ? `: ${String(j.error).slice(0, 200)}` : ""}`);
  return j as T;
}
const act = async (cfg: LevelupConfig, id: number, body: Record<string, unknown>) => (await api<{ item: LuItem }>(cfg, "POST", `/items/${id}`, { machine: await machineLabel(), ...body })).item;

/** Connect: check the key works, then keep it on this machine. */
export async function connectLevelup(url: string, key: string): Promise<{ workspace: number }> {
  const cfg: LevelupConfig = { url: cleanUrl(url), key: String(key).trim(), connectedAt: Date.now() };
  if (!/^luf_\d+_\d+_[A-Za-z0-9_-]{20,64}$/.test(cfg.key)) throw new Error("That doesn't look like a Fleet key (it starts with luf_). Make one in LevelUp: Fleet → Connect Mission Control.");
  const r = await api<{ ok: boolean; workspace: number }>(cfg, "GET", "/ping");
  await writeJson(CONFIG, cfg);
  await writeJson(STATUS, { ok: true, at: Date.now(), workspace: r.workspace } satisfies LevelupStatus);
  return { workspace: r.workspace };
}
export async function disconnectLevelup(): Promise<void> {
  await fsp.rm(CONFIG, { force: true });
  await fsp.rm(STATUS, { force: true });
}

// ─── the tick ───

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const taskIdOf = (itemId: number) => `lu-${itemId}`;
let busy = false;
let lastOutbox = { hash: "", at: 0 };

function toPlanPlace(p: Place): PlanPlace {
  return { key: p.key, label: p.label, host: p.host, hostLabel: p.hostLabel, folder: p.folder, tool: p.tool, agent: p.agent, agentLabel: p.agentLabel, kind: p.kind, teammateId: p.teammateId, edit: p.edit, local: p.local, lan: p.lan };
}
function assigneeOf(p: PlanPlace | null, myLabel: string): Assignee {
  if (!p) return { kind: "machine", host: me(), hostLabel: myLabel, tool: "claude", folder: "~" };
  if (p.kind === "teammate") return { kind: "teammate", id: p.teammateId!, name: p.label.replace(/ \(teammate\)$/, "") };
  return { kind: "machine", host: p.host, hostLabel: p.hostLabel, tool: (p.tool ?? "claude") as any, agent: p.agent, agentLabel: p.agentLabel, folder: p.folder };
}

/** One pass (the scheduler's instance only, every minute; rule 1). */
export async function levelupTick(): Promise<void> {
  const cfg = readLevelupConfig();
  if (!cfg || busy) return;
  if (!(await import("./workHome")).isWorkHome()) return; // hand-offs are Work tasks: the Work home handles them (rule 48)
  if (!(await import("./modules")).moduleOn("levelup")) return; // the LevelUp module is switched off (rule 53)
  busy = true;
  try {
    const myLabel = await machineLabel();
    const { items } = await api<{ items: LuItem[] }>(cfg, "GET", "/items?days=7");
    let tasks = await readTasks();
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const needPlaces = items.some((i) => i.status === "requested" || (i.status === "proposed" && i.data.claimedBy === myLabel));
    let places: Record<string, PlanPlace[]> = {};
    let repos: string[] = [];
    if (needPlaces) {
      const m = await fleetPlaces();
      places = Object.fromEntries([...m].map(([k, v]) => [k.toLowerCase(), v.map(toPlanPlace)]));
      repos = ((await readGithubReport())?.repos ?? []).map((r) => r.id);
    }
    const areas = readAreas();
    const areaPlaces: Record<string, PlanPlace> = Object.fromEntries(Object.entries(areas.folders).map(([n, f]) => [n, { key: `${f.host}|${f.tool}|${f.folder}`, label: `${f.hostLabel} · ${f.agentLabel ?? (f.tool === "codex" ? "Codex" : "Claude Code")}`, host: f.host, hostLabel: f.hostLabel, folder: f.folder, tool: f.tool, agent: f.agent, agentLabel: f.agentLabel, kind: "machine" as const, edit: true, local: f.host === me(), lan: true }]));
    const pick = (ps: PlanPlace[]) => pickPlace(ps as any) as PlanPlace | null;

    for (const item of items) {
      const tid = taskIdOf(item.id);
      const task = byId.get(tid);
      const step = nextStep(item, task, myLabel, today());
      try {
        if (step === "propose" || (item.status === "proposed" && item.data.claimedBy === myLabel && task && task.assignedBy === "you" && task.luProposed !== assigneeLabel(task.assignee))) {
          // a new hand-off, or the owner changed who does it here before approving: (re)propose
          let plan = planFor(item, { repos, places, areaPlaces, pick, myLabel });
          let assignee = assigneeOf(plan.place, myLabel);
          if (task && task.assignedBy === "you" && item.status === "proposed") {
            assignee = task.assignee;
            const label = assigneeLabel(assignee);
            const folder = assignee.kind === "machine" ? assignee.folder : "";
            plan = { ...plan, summary: `${label} works on it${folder ? ` in ${folder === "~" ? "the home folder" : folder}` : ""}${task.access === "edit" ? ", and may change files there" : ", answer only"} (chosen in Mission Control).`, access: task.access };
          }
          const updated = await act(cfg, item.id, { action: "propose", summary: plan.summary, place: assigneeLabel(assignee), folder: assignee.kind === "machine" ? assignee.folder : undefined, tool: assignee.kind === "machine" ? assignee.tool : undefined, repo: plan.repo });
          await upsertTask(item, updated, { assignee, access: plan.access, repo: plan.repo, why: plan.why, proposed: assigneeLabel(assignee) });
        } else if (step === "approve") {
          await act(cfg, item.id, { action: "approve" });
          await patch(tid, (t) => noteTask(t, "approval sent to LevelUp"));
        } else if (step === "start") {
          // approved work may be planned for a day nobody is watching: the fleet pause holds it (rule 32)
          if (isPaused()) continue;
          const notes = sentBackNotes(item);
          await upsertTask(item, item, {});
          await mutateTasks((all) => {
            const t = all.find((x) => x.id === tid);
            if (!t) return;
            t.approval = "approved";
            t.brief = luPrompt(item, t.access, notes);
            if (t.status === "review" || t.status === "done") t.status = "todo";
          });
          let started: RepoTask;
          try {
            started = await startTask(tid);
          } catch (e) {
            await act(cfg, item.id, { action: "fail", error: (e as Error).message.slice(0, 400) });
            continue;
          }
          await act(cfg, item.id, { action: "start", jobId: started.job?.id, host: started.assignee.kind === "machine" ? started.assignee.hostLabel : undefined, text: `Started with ${assigneeLabel(started.assignee)}` });
        } else if (step === "finish" && task) {
          await act(cfg, item.id, { action: "finish", result: task.result?.text ?? "", text: `${assigneeLabel(task.assignee)} finished: ready for your review` });
        } else if (step === "fail") {
          await act(cfg, item.id, { action: "fail", error: task?.result?.error || (task ? "It didn't finish" : "Mission Control lost track of it (its Work task is gone)") });
        } else if (step === "done") {
          await act(cfg, item.id, { action: "done" });
        } else if (step === "ack") {
          if (task?.status === "doing" && task.job?.via === "job") await startJob({ mode: "stop", jobId: task.job.id }).catch(() => {});
          await patch(tid, (t) => { t.status = "dismissed"; noteTask(t, "cancelled in LevelUp"); });
          await act(cfg, item.id, { action: "ackCancel", text: task?.status === "doing" ? "Stopped" : "Noted" });
        } else if (step === "mirror") {
          await patch(tid, (t) => {
            const to = item.status === "done" ? "done" : item.status === "cancelled" ? "dismissed" : "todo";
            if (t.status !== to) { noteTask(t, `${item.status} in LevelUp`); t.status = to; }
          });
        } else if (task && (item.title !== task.title || areaOf(item) !== task.area)) {
          await patch(tid, (t) => { t.title = item.title; t.area = areaOf(item); });
        }
      } catch (e) {
        console.warn(`[levelup] hand-off ${item.id} (${item.status} → ${step}):`, (e as Error).message);
      }
    }

    // what is waiting on the owner here, for LevelUp's Fleet panel
    tasks = await readTasks();
    const out = outboxFrom(tasks as any, areas.repos);
    const hash = JSON.stringify(out.map((o) => [o.id, o.kind, o.title, o.area]));
    let outboxAt = lastOutbox.at;
    if (hash !== lastOutbox.hash || Date.now() - lastOutbox.at > 15 * 60_000) {
      await api(cfg, "PUT", "/outbox", { items: out, machine: myLabel });
      lastOutbox = { hash, at: Date.now() };
      outboxAt = lastOutbox.at;
    }
    await writeJson(STATUS, { ok: true, at: Date.now(), items: items.length, open: items.filter((i) => ["requested", "proposed", "approved", "running", "review"].includes(i.status)).length, outboxAt, outboxCount: out.length } satisfies LevelupStatus);
  } catch (e) {
    await writeJson(STATUS, { ok: false, at: Date.now(), error: (e as Error).message.slice(0, 300) } satisfies LevelupStatus).catch(() => {});
  } finally {
    busy = false;
  }
}

const areaOf = (item: LuItem) => (item.data.area ? (item.data.area.type === "personal" ? `Personal${item.data.area.goalTitle ? ` · ${item.data.area.goalTitle}` : ""}` : item.data.area.name) : null);

async function patch(id: string, fn: (t: RepoTask) => void) {
  await mutateTasks((all) => {
    const t = all.find((x) => x.id === id);
    if (t) fn(t);
  });
}

/** Our Work copy of a hand-off (made on the first proposal, kept in step after). */
async function upsertTask(item: LuItem, latest: LuItem, o: { assignee?: Assignee; access?: "edit" | "answer"; repo?: string | null; why?: string; proposed?: string }) {
  const now = Date.now();
  await mutateTasks((all) => {
    let t = all.find((x) => x.id === taskIdOf(item.id));
    if (!t) {
      t = {
        id: taskIdOf(item.id),
        repo: o.repo ?? "levelup",
        title: item.title,
        source: { kind: "levelup", label: `LevelUp hand-off${item.data.area ? ` · ${areaOf(item)}` : ""}` },
        owner: false,
        priority: 2,
        status: "todo",
        assignee: o.assignee ?? { kind: "none" },
        access: o.access ?? "answer",
        firstSeen: now,
        lastSeen: now,
        updatedAt: now,
        history: [{ at: now, what: "handed to the fleet in LevelUp" }],
      } as RepoTask;
      all.push(t);
    }
    t.origin = { kind: "levelup", id: item.id };
    t.area = areaOf(latest);
    t.when = latest.data.when ?? null;
    t.title = latest.title;
    t.lastSeen = now;
    if (o.assignee) { t.assignee = o.assignee; t.assignedBy = t.assignedBy === "you" ? "you" : "levelup"; }
    if (o.access) t.access = o.access;
    if (o.repo !== undefined) t.repo = o.repo ?? "levelup";
    if (o.why) t.assignReason = o.why;
    if (o.proposed) { t.luProposed = o.proposed; noteTask(t, `proposed to the owner: ${o.proposed}`); }
    if (latest.status === "proposed") t.approval = t.approval === "approved" ? "approved" : "waiting";
    if (latest.status === "approved" || latest.status === "running") t.approval = "approved";
  });
}

/** Approve here (Work → Approve): tell LevelUp at once; the next tick starts it. */
export async function approveLevelupTask(taskId: string): Promise<void> {
  const cfg = readLevelupConfig();
  const t = (await readTasks()).find((x) => x.id === taskId);
  if (!t || t.origin?.kind !== "levelup") throw new Error("That isn't a LevelUp hand-off.");
  await patch(taskId, (x) => { x.approval = "approved"; noteTask(x, "approved in Mission Control"); });
  if (cfg) await act(cfg, t.origin.id, { action: "approve" }).catch((e) => console.warn("[levelup] approve:", (e as Error).message));
}

/** For the Work page: connection, areas, the known folders (for the area work-folder choice). */
export async function levelupForPage() {
  const cfg = readLevelupConfig();
  const areas = readAreas();
  const report = await readGithubReport().catch(() => null);
  return {
    connected: !!cfg,
    url: cfg?.url ?? null,
    connectedAt: cfg?.connectedAt ?? null,
    status: readLevelupStatus(),
    areas: { names: areaNames(), clients: areas.clients, repos: areas.repos, folders: areas.folders },
    repoAreas: Object.fromEntries((report?.repos ?? []).map((r) => [r.id, areaOfRepo(r.id, areas.repos)])),
  };
}
