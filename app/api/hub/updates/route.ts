import os from "os";
import { clusterStatus } from "@/lib/cluster";
import { productName } from "@/lib/netSettings";
import { listJobs, startJob, type SessionJob } from "@/lib/sessionActions";
import { readRemoteSessions, readShareSettings, shareNow, writeShareSettings } from "@/lib/sessionShare";
import { buildInfo, compareToOrigin, diskBuild, originInfo, readUpdateStatus, updateBlockers, type BuildInfo } from "@/lib/selfUpdate";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const slimJob = (j?: SessionJob) =>
  j && {
    id: j.id,
    status: j.status,
    reply: j.reply,
    error: j.error,
    createdAt: j.createdAt,
    finishedAt: j.finishedAt,
    steps: j.progress?.steps ?? [],
    requestedByLabel: j.requestedByLabel,
  };

async function view(fetch = false) {
  const [st, files, settings, jobs, origin] = await Promise.all([
    clusterStatus().catch(() => null),
    readRemoteSessions().catch(() => []),
    readShareSettings(),
    listJobs(),
    originInfo(fetch).catch(() => null),
  ]);
  const me = os.hostname();
  const updates = jobs.filter((j) => j.mode === "update").sort((a, b) => b.createdAt - a.createdAt);
  const self = buildInfo();
  const disk = diskBuild();
  const now = Date.now();

  const rows: {
    host: string;
    label: string;
    self: boolean;
    online: boolean;
    via?: "lan" | "vault";
    publishedAt?: number;
    build?: BuildInfo;
    selfUpdate?: number;
    updatesAllowed?: boolean;
    acceptsReplies?: string;
  }[] = [{ host: me, label: st?.config.enabled ? st.config.label || me : me, self: true, online: true, build: self ?? undefined, selfUpdate: 1, updatesAllowed: settings.remoteUpdates }];
  const online = new Map((st?.nodes ?? []).map((n) => [n.host.toLowerCase(), n.online]));
  for (const f of files) {
    rows.push({
      host: f.host,
      label: f.label || f.host,
      self: false,
      online: f.via === "lan" || (online.get(f.host.toLowerCase()) ?? now - f.publishedAt < 2 * 60 * 60_000),
      via: f.via === "lan" ? "lan" : "vault",
      publishedAt: f.publishedAt,
      build: f.build,
      selfUpdate: f.selfUpdate,
      updatesAllowed: f.updatesAllowed,
      acceptsReplies: f.acceptsReplies ?? "off",
    });
  }
  // machines in the group that don't publish sessions at all (sharing off, or very old code)
  for (const n of st?.nodes ?? []) {
    if (!n.self && !rows.some((r) => r.host.toLowerCase() === n.host.toLowerCase())) rows.push({ host: n.host, label: n.label, self: false, online: n.online });
  }

  const machines = await Promise.all(
    rows.map(async (r) => ({
      ...r,
      compare: await compareToOrigin(r.build?.commit, origin).catch(() => null),
      job: slimJob(updates.find((j) => j.host === r.host && (r.self || !j.requestedBy))),
    })),
  );
  return {
    product: productName(),
    origin,
    machines,
    self: {
      host: me,
      remoteUpdates: settings.remoteUpdates,
      remoteReplies: settings.remoteReplies,
      // built but not restarted yet (a hand build, or an update that is restarting)
      pendingRestart: Boolean(self && disk && disk.commit !== self.commit),
      blockers: await updateBlockers().catch(() => []),
      lastStatus: readUpdateStatus(),
    },
  };
}

/** GET [?fetch=1] → every machine's build, how far behind GitHub it is, and its latest update. */
export async function GET(req: Request) {
  try {
    return Response.json(await view(new URL(req.url).searchParams.get("fetch") === "1"));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

/**
 * { action: "update", host }      update that machine (this one included) once nothing runs there
 * { action: "allow", value }      this machine's "Updates from my other machines"
 * { action: "fetch" }             look at GitHub now
 */
export async function POST(req: Request) {
  let b: { action?: string; host?: string; value?: unknown };
  try {
    b = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  try {
    if (b.action === "update") {
      if (!b.host || !/^[\w.-]{1,80}$/.test(b.host)) return Response.json({ error: "bad host" }, { status: 400 });
      const job = await startJob({ mode: "update", host: b.host });
      return Response.json({ job: slimJob(job), ...(await view()) });
    }
    if (b.action === "allow" && typeof b.value === "boolean") {
      await writeShareSettings({ remoteUpdates: b.value });
      void shareNow().catch(() => {}); // the others learn it from this machine's summary
      return Response.json(await view());
    }
    if (b.action === "fetch") return Response.json(await view(true));
    return Response.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
