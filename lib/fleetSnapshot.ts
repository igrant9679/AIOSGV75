import os from "os";
import fs from "fs";
import path from "path";

/**
 * One picture of the whole fleet for Talos (lib/talos.ts) and the digest (lib/talosNotify.ts): machines,
 * accounts, live sessions, jobs, Work, LevelUp hand-offs, runs, missions, approvals, permission prompts,
 * schedules, GitHub "waiting on you", the pause and health problems.
 *
 * Most of it is shared already (vault summaries). What only one machine holds (Work and the GitHub report
 * live on the machine whose GitHub CLI is signed in, private repository text kept out of the vault) is
 * fetched from each machine over the LAN when asked (`localPart`, peer route GET /peer/talos-local), so it
 * never goes into the vault. Every section is best effort: one that fails says so instead of sinking the rest.
 */

type Any = any;
const safe = async <T,>(fn: () => Promise<T>, label: string, errors: string[]): Promise<T | null> => {
  try {
    return await fn();
  } catch (e) {
    errors.push(`${label}: ${(e as Error).message.slice(0, 120)}`);
    return null;
  }
};

/** What only THIS machine knows: its Work tasks, its GitHub report, its LevelUp link. Names and counts plus the top items. */
export async function localPart(): Promise<Any> {
  const errors: string[] = [];
  const out: Any = { host: os.hostname(), at: Date.now() };
  const home = (await import("./workHome")).isWorkHome(); // old copies on other machines aren't Work any more (rule 48)
  const work = !home ? null : await safe(async () => {
    const { readTasks, assigneeLabel } = await import("./repoTasks");
    const tasks = await readTasks();
    if (!tasks.length) return null;
    const open = tasks.filter((t) => !["done", "dismissed"].includes(t.status));
    const count = (f: (t: Any) => boolean) => open.filter(f).length;
    const byWho: Record<string, number> = {};
    for (const t of open) {
      const k = t.assignee.kind === "none" ? "nobody" : assigneeLabel(t.assignee);
      byWho[k] = (byWho[k] ?? 0) + 1;
    }
    const byRepo: Record<string, number> = {};
    for (const t of open) byRepo[t.repo] = (byRepo[t.repo] ?? 0) + 1;
    const item = (t: Any) => ({ id: t.id, title: t.title.slice(0, 160), repo: t.repo, status: t.status, who: t.assignee.kind === "none" ? "nobody" : assigneeLabel(t.assignee), area: t.area ?? null, priority: t.priority, approval: t.approval, source: t.source.kind });
    return {
      open: open.length,
      byStatus: { inbox: count((t) => t.status === "inbox"), todo: count((t) => t.status === "todo"), doing: count((t) => t.status === "doing"), review: count((t) => t.status === "review") },
      byWho,
      byRepo,
      levelupWaitingApproval: open.filter((t) => t.origin?.kind === "levelup" && t.approval !== "approved").map(item),
      doing: open.filter((t) => t.status === "doing").map(item),
      review: open.filter((t) => t.status === "review").slice(0, 30).map(item),
      yours: open.filter((t) => t.assignee.kind === "me").sort((a, b) => a.priority - b.priority).slice(0, 40).map(item),
      fleetReady: open.filter((t) => t.status === "todo" && (t.assignee.kind === "machine" || t.assignee.kind === "teammate") && !t.origin).slice(0, 40).map(item),
    };
  }, "work", errors);
  if (work) out.work = work;
  const gh = await safe(async () => {
    const { readGithubReport } = await import("./githubReport");
    const r: Any = await readGithubReport();
    if (!r || r.anonymous) return null;
    // "waiting on you" lives per repository (GitHub's signals + the status documents' items)
    const waiting: Any[] = (r.repos ?? []).flatMap((x: Any) => (x.waiting ?? []).map((w: Any) => ({ ...w, repo: x.id }))).sort((a: Any, b: Any) => (a.priority ?? 3) - (b.priority ?? 3));
    return { at: r.generatedAt, repos: (r.repos ?? []).length, headline: r.overall?.headline, waiting: waiting.length, topWaiting: waiting.slice(0, 15).map((w: Any) => ({ title: String(w.title ?? w.text ?? "").slice(0, 160), repo: w.repo, kind: w.kind })) };
  }, "github", errors);
  if (gh) out.github = gh;
  const lu = await safe(async () => {
    const { readLevelupConfig, readLevelupStatus } = await import("./levelup");
    const c = readLevelupConfig();
    return c ? { connected: true, status: readLevelupStatus() } : null;
  }, "levelup", errors);
  if (lu) out.levelup = lu;
  if (errors.length) out.errors = errors;
  return out;
}

/**
 * Several machines can hold Work (each one whose GitHub CLI is signed in builds the list from the same
 * repositories), so the same task appears on each, under the same id. One picture: counts over the union of
 * ids, each task as its most recently changed copy, and which machines hold a copy.
 */
export function mergeWork(holders: Any[]): Any[] {
  if (holders.length <= 1) return holders;
  const lists = ["levelupWaitingApproval", "doing", "review", "yours", "fleetReady"] as const;
  const merged: Any = { heldBy: holders.map((h) => h.heldBy).join(", "), copies: holders.map((h) => ({ machine: h.heldBy, open: h.open })) };
  for (const k of lists) {
    const seen = new Map<string, Any>();
    for (const h of holders) for (const t of h[k] ?? []) if (!seen.has(t.id)) seen.set(t.id, { ...t, heldBy: h.heldBy });
    merged[k] = [...seen.values()];
  }
  // counts: the copy with the most open tasks is the fullest picture; the others are mostly the same tasks
  const fullest = [...holders].sort((a, b) => (b.open ?? 0) - (a.open ?? 0))[0];
  merged.open = fullest.open;
  merged.byStatus = fullest.byStatus;
  merged.byWho = fullest.byWho;
  merged.byRepo = fullest.byRepo;
  merged.countsFrom = fullest.heldBy;
  merged.note = `The same repositories' tasks are kept on ${holders.length} machines (${merged.heldBy}); counts are from ${fullest.heldBy}'s copy.`;
  return [merged];
}

/** The whole fleet, as seen from this machine (plus the other machines' local parts over the LAN). */
export async function buildSnapshot(opts: { peers?: boolean } = {}): Promise<Any> {
  const errors: string[] = [];
  const snap: Any = { at: Date.now(), from: os.hostname() };

  const cluster: Any = await safe(async () => (await import("./cluster")).clusterStatus(), "machines", errors);
  const remote: Any[] = (await safe(async () => (await import("./sessionShare")).readRemoteSessions(), "summaries", errors)) ?? [];
  const local: Any = await safe(async () => (await import("./sessionShare")).localSummary(), "this machine", errors);
  const summaries = [...(local ? [local] : []), ...remote];
  const health: Record<string, Any> = {};
  await safe(async () => {
    const { vaultInfo } = await import("./vault");
    const dir = path.join(vaultInfo().base, "Cluster", "health");
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
        health[f.replace(/\.json$/, "")] = (j.checks ?? []).filter((c: Any) => c.level === "fail" || c.level === "warn").map((c: Any) => ({ level: c.level, label: c.label, detail: String(c.detail ?? "").slice(0, 200) }));
      } catch {
        /* one file */
      }
    }
  }, "health", errors);

  snap.machines = (cluster?.nodes ?? []).map((n: Any) => {
    const s = summaries.find((x) => x.host === n.host);
    return {
      host: n.host,
      label: n.label ?? n.host,
      role: n.role,
      master: !!n.isMaster,
      online: !!n.online,
      lastSeenMinutesAgo: n.ts ? Math.round((Date.now() - n.ts) / 60000) : null,
      lan: n.lanAddrs?.length ? "yes" : "no",
      load: n.load ? { cpu: n.load.cpu, memUsed: n.load.memUsed, commitUsed: n.load.commitUsed, memTotalGb: n.load.memTotalGb } : null,
      version: s?.build?.short ?? null,
      allowsFromOtherMachines: s?.acceptsReplies ?? null,
      health: health[n.host] ?? [],
      subscriptions: (s?.subscriptions ?? []).map((m: Any) => ({ tool: m.tool, plan: m.plan, status: m.status, usedPercent: m.usedPercent, resetsAt: m.resetsAt ? new Date(m.resetsAt).toISOString() : undefined, note: m.note })),
      localModel: s?.localModel?.model ?? null,
      acpAgents: (s?.acpAgents ?? []).map((a: Any) => a.label),
    };
  });
  snap.master = cluster?.master ?? null;
  snap.pause = await safe(async () => (await import("./fleetPause")).readPause(), "pause", errors);

  // live sessions (every machine's summary) and jobs (this machine's view of what it sent and received)
  snap.sessions = {
    open: summaries.flatMap((s) => (s.sessions ?? []).filter((x: Any) => x.status === "running" || x.status === "waiting" || x.live).map((x: Any) => ({ key: x.key, machine: s.label, tool: x.tool, project: x.project, title: String(x.title ?? "").slice(0, 120), status: x.status }))).slice(0, 60),
    recentCount: summaries.reduce((a, s) => a + (s.sessions ?? []).filter((x: Any) => Date.now() - (x.updatedAt ?? 0) < 24 * 3600e3).length, 0),
  };
  const jobs: Any[] = (await safe(async () => (await import("./sessionActions")).listJobs(), "jobs", errors)) ?? [];
  snap.jobs = {
    active: jobs.filter((j) => ["queued", "sent", "running", "waiting"].includes(j.status)).map((j) => ({ id: j.id, mode: j.mode, machine: j.hostLabel, tool: j.tool, status: j.status, title: String(j.title ?? j.prompt ?? "").slice(0, 100), waitReason: j.waitReason })),
    // a job someone stopped on purpose isn't a failure
    failedLast24h: jobs.filter((j) => j.status === "error" && !/^stopped\b/i.test(String(j.error ?? "")) && Date.now() - (j.finishedAt ?? j.createdAt ?? 0) < 24 * 3600e3).slice(0, 20).map((j) => ({ id: j.id, mode: j.mode, machine: j.hostLabel, error: String(j.error ?? "").slice(0, 160) })),
  };
  const runs: Any[] = (await safe(async () => (await import("./runs")).listRuns(30), "runs", errors)) ?? [];
  snap.runs = runs.filter((r) => !["done", "failed", "stopped"].includes(r.status) || Date.now() - (r.updatedAt ?? 0) < 3 * 24 * 3600e3).map((r) => ({ id: r.id, title: r.title, status: r.status, machine: r.hostLabel, tasks: (r.tasks ?? []).length, done: (r.tasks ?? []).filter((t: Any) => t.status === "done").length }));
  const missions: Any[] = (await safe(async () => (await import("./missions")).listMissions(), "missions", errors)) ?? [];
  snap.missions = missions.filter((m) => m.status === "running" || Date.now() - (m.createdAt ?? 0) < 24 * 3600e3).slice(0, 15).map((m) => ({ id: m.id, title: String(m.title ?? m.prompt ?? "").slice(0, 100), status: m.status, strategy: m.strategy }));
  const approvals: Any[] = (await safe(async () => (await import("./approvals")).listApprovals(), "approvals", errors)) ?? [];
  snap.approvals = approvals.filter((a) => a.status === "pending").map((a) => ({ id: a.id, kind: a.kind, source: a.source, ageMinutes: Math.round((Date.now() - a.ts) / 60000), what: String(a.payload ?? "").slice(0, 200) }));
  const perms: Any = await safe(async () => (await import("./permissions")).pendingFleet(), "permission prompts", errors);
  snap.permissionPrompts = (perms?.items ?? []).map((p: Any) => ({ id: p.id, machine: p.hostLabel ?? p.host, host: p.host, tool: p.tool, what: String(p.summary ?? p.toolName ?? "").slice(0, 160), project: p.project }));
  const schedules: Any[] = (await safe(async () => (await import("./schedules")).listSchedules(), "schedules", errors)) ?? [];
  snap.schedules = schedules.map((s) => ({ id: s.id, title: s.title, enabled: s.enabled, freq: s.freq, time: s.time, weekday: s.weekday, lastRun: s.lastRun ? new Date(s.lastRun).toISOString() : null, lastStatus: s.lastStatus ?? null, nextRun: s.nextRun ? new Date(s.nextRun).toISOString() : null }));

  // the machines' own local parts (Work, GitHub report, LevelUp link)
  const parts: Any[] = [];
  const me = await localPart();
  if (me.work || me.github || me.levelup) parts.push({ ...me, label: snap.machines.find((m: Any) => m.host === me.host)?.label ?? me.host });
  if (opts.peers !== false) {
    const { peerFetch } = await import("./peer");
    const others = snap.machines.filter((m: Any) => m.host !== os.hostname() && m.online);
    const got = await Promise.all(others.map((m: Any) => peerFetch<Any>(m.host, "/peer/talos-local", { timeoutMs: 6000 }).then((p) => ({ ...p, label: m.label })).catch((e) => ({ host: m.host, label: m.label, unreachable: (e as Error).message.slice(0, 100) }))));
    for (const p of got) if (p.work || p.github || p.levelup || p.unreachable) parts.push(p);
  }
  snap.work = mergeWork(parts.filter((p) => p.work).map((p) => ({ heldBy: p.label, ...p.work })));
  snap.github = parts.filter((p) => p.github).map((p) => ({ heldBy: p.label, ...p.github }))[0] ?? null;
  snap.levelup = parts.filter((p) => p.levelup).map((p) => ({ heldBy: p.label, ...p.levelup }));
  const unreachable = parts.filter((p) => p.unreachable).map((p) => `${p.label} (${p.unreachable})`);
  if (unreachable.length) snap.notReachedOverLan = unreachable;
  if (errors.length) snap.errors = errors;
  return snap;
}
