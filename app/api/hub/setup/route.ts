import os from "os";
import { listJobs, newJobId, startJob } from "@/lib/sessionActions";
import { readConfig } from "@/lib/cluster";
import { PeerUnavailable, peerFetch } from "@/lib/peer";
import { logRemote } from "@/lib/remoteLog";
import { installSkill, packSkill, SKILL_NAME_RE, type SkillPackage } from "@/lib/skillCopy";
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

/**
 * Copy a skill: packed where it is (this machine, or another one over the LAN), then installed
 * where it goes (here directly, or as a setup job that needs "Answers + file edits" there).
 */
async function copySkill(b: { from?: string; to?: string; name?: string; replace?: boolean }): Promise<{ job?: { id: string; status: string; reply?: string }; reply?: string; error?: string }> {
  const HOST = /^[\w.-]{1,80}$/;
  if (!b.from || !b.to || !HOST.test(b.from) || !HOST.test(b.to)) return { error: "bad machine" };
  if (!b.name || !SKILL_NAME_RE.test(b.name)) return { error: "bad skill name" };
  if (b.from.toLowerCase() === b.to.toLowerCase()) return { error: "Pick a different machine to copy to." };
  const me = os.hostname().toLowerCase();
  const cfg = await readConfig().catch(() => null);
  const myLabel = cfg?.label || os.hostname();
  let pkg: SkillPackage;
  if (b.from.toLowerCase() === me) {
    pkg = packSkill(b.name, myLabel);
  } else {
    const id = newJobId();
    const entry = { id, dir: "out" as const, host: b.from, from: os.hostname(), fromLabel: myLabel, kind: "skill" as const, via: "lan" as const, what: `fetch skill ${b.name}` };
    try {
      pkg = await peerFetch<SkillPackage>(b.from, `/peer/skill?name=${encodeURIComponent(b.name)}&job=${id}`, { timeoutMs: 60_000 });
      await logRemote({ ...entry, outcome: "accepted" });
    } catch (e) {
      await logRemote({ ...entry, outcome: "refused", reason: (e as Error).message });
      if (e instanceof PeerUnavailable) return { error: "That machine can't be reached over the LAN right now. A skill is fetched directly, not through the vault." };
      return { error: (e as Error).message };
    }
  }
  if (b.to.toLowerCase() === me) return { reply: await installSkill(pkg, { replace: b.replace === true }) };
  const job = await startJob({ mode: "setup", host: b.to, setupAction: "skill-install", setupTarget: b.name, skillPackage: pkg, replace: b.replace === true });
  if (job.status === "error") return { error: job.error };
  return { job: { id: job.id, status: job.status, reply: job.reply } };
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
 * { action: "copy-skill", from, to, name, replace? }   copy one of your own skills between machines
 * { action: "refresh" }   re-read this machine now (CLI versions too) and share it
 */
export async function POST(req: Request) {
  let b: { action?: string; host?: string; change?: string; target?: string; from?: string; to?: string; name?: string; replace?: boolean };
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
      if (!SETUP_ACTIONS.includes(b.change as SetupAction) || b.change === "skill-install") return Response.json({ error: "bad change" }, { status: 400 });
      const job = await startJob({ mode: "setup", host: b.host, setupAction: b.change as SetupAction, setupTarget: b.target });
      if (job.status === "error") return Response.json({ error: job.error, ...(await view()) }, { status: 400 });
      return Response.json({ job: { id: job.id, status: job.status, reply: job.reply }, ...(await view()) });
    }
    if (b.action === "copy-skill") {
      const r = await copySkill(b);
      return Response.json({ ...r, ...(await view()) }, { status: r.error ? 400 : 200 });
    }
    return Response.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
