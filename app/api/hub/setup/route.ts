import { listJobs, startJob } from "@/lib/sessionActions";
import { readRemoteSessions } from "@/lib/sessionShare";
import { allSetups, collectSetup, publishSetup, SETUP_ACTIONS, type SetupAction } from "@/lib/machineSetup";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function view() {
  const [setups, remote, jobs] = await Promise.all([allSetups(), readRemoteSessions().catch(() => []), listJobs()]);
  const setupJobs = jobs.filter((j) => j.mode === "setup" && !j.requestedBy).slice(0, 20);
  return {
    machines: setups.map((s, i) => ({
      ...s,
      self: i === 0,
      // what that machine lets the others change (Fleet → Sharing there): setup changes need "edit"
      acceptsReplies: i === 0 ? "edit" : (remote.find((r) => r.host.toLowerCase() === s.host.toLowerCase())?.acceptsReplies ?? "off"),
    })),
    jobs: setupJobs.map((j) => ({ id: j.id, host: j.host, hostLabel: j.hostLabel, action: j.setupAction, target: j.setupTarget, status: j.status, reply: j.reply, error: j.error, createdAt: j.createdAt, finishedAt: j.finishedAt })),
  };
}

/** GET → every machine's AI-tool setup (this one read now, the others from the vault) and recent changes. */
export async function GET() {
  try {
    return Response.json(await view());
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

/**
 * { action: "change", host, change: "mcp-off" | "mcp-on" | "plugin-off" | "plugin-on", target }
 * { action: "refresh" }   re-read this machine now (CLI versions too) and share it
 */
export async function POST(req: Request) {
  let b: { action?: string; host?: string; change?: string; target?: string };
  try {
    b = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  try {
    if (b.action === "refresh") {
      await collectSetup(true);
      await publishSetup(true);
      return Response.json(await view());
    }
    if (b.action === "change") {
      if (!b.host || !/^[\w.-]{1,80}$/.test(b.host)) return Response.json({ error: "bad host" }, { status: 400 });
      if (!SETUP_ACTIONS.includes(b.change as SetupAction)) return Response.json({ error: "bad change" }, { status: 400 });
      const job = await startJob({ mode: "setup", host: b.host, setupAction: b.change as SetupAction, setupTarget: b.target });
      if (job.status === "error") return Response.json({ error: job.error, ...(await view()) }, { status: 400 });
      return Response.json({ job: { id: job.id, status: job.status, reply: job.reply }, ...(await view()) });
    }
    return Response.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
