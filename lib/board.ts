/**
 * The live board (/city, rule 49): everything the fleet is doing or waiting on, as ONE list, whatever page
 * it belongs to — Work tasks, LevelUp hand-offs, session jobs, runs, missions, approvals, AI permission
 * prompts, Talos / JARVIS confirm cards. Each item is in one of five states (waiting on you, pending,
 * running, done, failed), names the machine and engine it is on, and carries the buttons that settle it
 * (each a plain call to the API that page already uses, so the board adds no new powers).
 * Built from the fleet snapshot (lib/fleetSnapshot.ts) plus this machine's finished jobs and cards.
 */

type Any = any;
export type BoardState = "waiting" | "pending" | "running" | "done" | "failed";
export interface BoardAction { label: string; style?: "primary" | "danger"; method: "POST" | "PATCH"; path: string; body: Record<string, unknown> }
export interface BoardItem {
  id: string;
  kind: "work" | "levelup" | "job" | "run" | "mission" | "approval" | "permission" | "card";
  kindLabel: string;
  title: string;
  detail?: string;
  state: BoardState;
  /** the machine it is on (label), when it is on one */
  machine?: string;
  engine?: string;
  area?: string | null;
  at?: number;
  href?: string;
  actions?: BoardAction[];
}
export interface Board {
  at: number;
  items: BoardItem[];
  counts: Record<BoardState, number>;
  machines: { host: string; label: string; online: boolean; master: boolean; cpu?: number; mem?: number; version?: string | null }[];
  /** the owner's own to-dos in Work (not on the board: they aren't the fleet's) */
  yours: number;
  notes: string[];
}

const DAY = 24 * 3600e3;
const engineName = (t?: string) => (t === "claude" ? "Claude Code" : t === "codex" ? "Codex" : t === "hermes" ? "Hermes" : t === "acp" ? "ACP agent" : t === "local" ? "Local model" : t || undefined);
const machineOf = (who?: string) => (who && who.includes(" · ") ? who.split(" · ")[0] : undefined);
const engineOf = (who?: string) => (who && who.includes(" · ") ? who.split(" · ")[1] : undefined);

export async function buildBoard(): Promise<Board> {
  const { buildSnapshot } = await import("./fleetSnapshot");
  const snap: Any = await buildSnapshot();
  const items: BoardItem[] = [];
  const notes: string[] = [];
  let yours = 0;

  for (const w of snap.work ?? []) {
    yours += w.byWho?.you ?? 0;
    for (const t of w.levelupWaitingApproval ?? [])
      items.push({ id: `work:${t.id}`, kind: "levelup", kindLabel: "LevelUp hand-off", title: t.title, detail: `Plan: ${t.who}. Approve to start it.`, state: "waiting", machine: machineOf(t.who), engine: engineOf(t.who), area: t.area, href: "/work", actions: [{ label: "Approve", style: "primary", method: "POST", path: "/api/work", body: { action: "approve", id: t.id } }] });
    for (const t of w.review ?? [])
      items.push({ id: `work:${t.id}`, kind: t.source === "levelup" ? "levelup" : "work", kindLabel: t.source === "levelup" ? "LevelUp hand-off" : "Work task", title: t.title, detail: `${t.who} finished: review the result${t.source === "levelup" ? " (accept or send back in LevelUp, or here)" : ""}.`, state: "waiting", machine: machineOf(t.who), engine: engineOf(t.who), area: t.area, href: "/work", actions: [{ label: "Accept", style: "primary", method: "POST", path: "/api/work", body: { action: "update", id: t.id, status: "done" } }] });
    for (const t of w.doing ?? []) items.push({ id: `work:${t.id}`, kind: t.source === "levelup" ? "levelup" : "work", kindLabel: t.source === "levelup" ? "LevelUp hand-off" : "Work task", title: t.title, detail: t.repo && t.repo !== "levelup" ? t.repo : undefined, state: "running", machine: machineOf(t.who), engine: engineOf(t.who), area: t.area, href: "/work" });
    for (const t of w.fleetReady ?? []) items.push({ id: `work:${t.id}`, kind: "work", kindLabel: "Work task", title: t.title, detail: `${t.repo} · assigned, not started`, state: "pending", machine: machineOf(t.who), engine: engineOf(t.who), area: t.area, href: "/work", actions: [{ label: "Start", style: "primary", method: "POST", path: "/api/work", body: { action: "start", id: t.id } }] });
  }

  for (const a of snap.approvals ?? [])
    items.push({ id: `approval:${a.id}`, kind: "approval", kindLabel: "Mission approval", title: a.what || "A mission wants to start", detail: `Asked by ${a.source}, ${a.ageMinutes} min ago`, state: "waiting", href: "/overview", actions: [{ label: "Approve", style: "primary", method: "PATCH", path: "/api/approvals", body: { id: a.id, approve: true } }, { label: "Reject", style: "danger", method: "PATCH", path: "/api/approvals", body: { id: a.id, approve: false } }] });
  for (const p of snap.permissionPrompts ?? [])
    items.push({ id: `perm:${p.host}:${p.id}`, kind: "permission", kindLabel: "AI asks permission", title: p.what || "Permission request", detail: p.project ? `In ${p.project}` : undefined, state: "waiting", machine: p.machine, engine: engineName(p.tool), actions: [{ label: "Allow", style: "primary", method: "POST", path: "/api/hub/permissions", body: { action: "decide", host: p.host, id: p.id, behavior: "allow" } }, { label: "Deny", style: "danger", method: "POST", path: "/api/hub/permissions", body: { action: "decide", host: p.host, id: p.id, behavior: "deny" } }] });

  for (const r of snap.runs ?? []) {
    const state: BoardState = r.status === "awaiting_approval" ? "waiting" : r.status === "done" ? "done" : r.status === "failed" || r.status === "stopped" ? "failed" : r.status === "paused" ? "pending" : "running";
    items.push({ id: `run:${r.id}`, kind: "run", kindLabel: "Project run", title: r.title, detail: `${r.done} of ${r.tasks} steps done · ${r.status.replace("_", " ")}`, state, machine: r.machine, href: "/runs", actions: r.status === "awaiting_approval" ? [{ label: "Approve the plan", style: "primary", method: "POST", path: "/api/runs", body: { action: "approve", id: r.id } }, { label: "Reject", style: "danger", method: "POST", path: "/api/runs", body: { action: "reject", id: r.id } }] : undefined });
  }
  for (const m of snap.missions ?? []) items.push({ id: `mission:${m.id}`, kind: "mission", kindLabel: "Mission", title: m.title, detail: m.strategy, state: m.status === "running" ? "running" : m.status === "error" || m.status === "failed" ? "failed" : "done", href: "/missions" });

  // session jobs: this machine's list (what it started and what it was asked to run)
  try {
    const { listJobs } = await import("./sessionActions");
    const jobs: Any[] = await listJobs();
    const workJobIds = new Set<string>();
    for (const j of jobs) {
      if (["stop", "thread", "import", "export", "permission"].includes(j.mode)) continue;
      const age = Date.now() - (j.finishedAt ?? j.createdAt ?? 0);
      const state: BoardState | null = ["queued", "sent", "waiting"].includes(j.status) ? "pending" : j.status === "running" ? "running" : j.status === "done" ? (age < DAY ? "done" : null) : j.status === "error" || j.status === "expired" ? (age < DAY && !/^stopped\b/i.test(String(j.error ?? "")) ? "failed" : null) : null;
      if (!state || workJobIds.has(j.id)) continue;
      const title = String(j.dispatch ? `${j.dispatch}: ` : "") + String(j.title ?? j.prompt ?? j.mode).replace(/\s+/g, " ").slice(0, 140);
      items.push({ id: `job:${j.id}`, kind: "job", kindLabel: j.mode === "update" ? "Update" : j.mode === "new" ? "New session" : j.mode === "reply" ? "Reply" : j.mode === "local" ? "Local model task" : j.mode === "check" ? "Check" : j.mode === "setup" ? "Setup change" : "Job", title, detail: state === "failed" ? String(j.error ?? "").slice(0, 200) : j.waitReason || (state === "done" ? String(j.reply ?? "").replace(/\s+/g, " ").slice(0, 200) : undefined), state, machine: j.hostLabel, engine: j.agentLabel ?? engineName(j.tool), at: j.finishedAt ?? j.createdAt, href: j.resultKey ? `/projects?session=${encodeURIComponent(j.resultKey)}` : "/projects", actions: state === "running" || state === "pending" ? [{ label: "Stop", style: "danger", method: "POST", path: "/api/hub/sessions", body: { action: "stop", jobId: j.id } }] : undefined });
    }
  } catch (e) {
    notes.push(`jobs: ${(e as Error).message}`);
  }
  try {
    const { recentCards } = await import("./talos");
    for (const c of await recentCards(20)) if (c.status === "waiting" && c.expiresAt > Date.now()) items.push({ id: `card:${c.id}`, kind: "card", kindLabel: "Confirm (Talos / JARVIS)", title: c.summary, detail: `${c.method} ${c.path}`, state: "waiting", machine: c.hostLabel, at: c.createdAt, actions: [{ label: "Yes, run it", style: "primary", method: "POST", path: "/api/talos", body: { op: "confirm", id: c.id, reply: "yes" } }, { label: "Cancel", style: "danger", method: "POST", path: "/api/talos", body: { op: "confirm", id: c.id, reply: "no" } }] });
  } catch {
    /* none */
  }
  if (snap.notReachedOverLan?.length) notes.push(`Couldn't reach: ${snap.notReachedOverLan.join(", ")}`);

  // one entry per id (a Work task's job also shows as a job: keep the Work entry)
  const seen = new Set<string>();
  const unique = items.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)));
  const counts: Record<BoardState, number> = { waiting: 0, pending: 0, running: 0, done: 0, failed: 0 };
  for (const i of unique) counts[i.state]++;
  return {
    at: Date.now(),
    items: unique,
    counts,
    machines: (snap.machines ?? []).map((m: Any) => ({ host: m.host, label: m.label, online: m.online, master: m.master, cpu: m.load?.cpu, mem: m.load?.commitUsed ?? m.load?.memUsed, version: m.version })),
    yours,
    notes,
  };
}
