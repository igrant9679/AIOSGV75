import os from "os";
import { readChecks, saveChecks, CHECK_TIMEOUT } from "@/lib/projectChecks";
import { sessionsSnapshot } from "@/lib/sessions";
import { listJobs, startJob } from "@/lib/sessionActions";

export const dynamic = "force-dynamic";

/**
 * The check commands THIS machine may run in a project folder (lib/projectChecks.ts).
 * Local on purpose: the list is per machine, it is only ever changed here, and a
 * folder must be one this machine's own sessions already use.
 */
async function knownFolder(folder: string): Promise<boolean> {
  if (!folder || folder === "~") return false;
  const snap = await sessionsSnapshot();
  return snap.sessions.some((s) => s.host === os.hostname() && (s.folder === folder || s.cwd === folder));
}

/**
 * GET ?folder=<path> → { folder, checks: [{ name, command, timeoutSec }], limits }
 * GET ?job=<id>      → how a "try it" run is going: { status, exitCode, output, error }
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const jobId = url.searchParams.get("job");
  if (jobId) {
    const job = (await listJobs()).find((j) => j.id === jobId && j.mode === "check");
    if (!job) return Response.json({ error: "That check run isn't in the list." }, { status: 404 });
    return Response.json({ status: job.status, exitCode: job.exitCode, output: job.reply ?? "", error: job.error, name: job.check });
  }
  const folder = url.searchParams.get("folder") ?? "";
  if (!(await knownFolder(folder))) return Response.json({ folder, checks: [], known: false, limits: CHECK_TIMEOUT });
  return Response.json({ folder, checks: await readChecks(folder), known: true, limits: CHECK_TIMEOUT });
}

/**
 * POST { folder, checks: [{ name, command, timeoutSec? }] } replaces that folder's list. An empty list removes it.
 * POST { action: "run", folder, name } runs one SAVED check now, to see that it works here → { jobId }
 */
export async function POST(request: Request) {
  let b: { action?: unknown; folder?: unknown; checks?: unknown; name?: unknown };
  try {
    b = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  const folder = typeof b.folder === "string" ? b.folder : "";
  if (!(await knownFolder(folder))) return Response.json({ error: "Checks can only be set for a project folder this machine's sessions use." }, { status: 400 });
  try {
    if (b.action === "run") {
      // by name only: the command is whatever this machine's list says, never something sent here
      const job = await startJob({ mode: "check", folder, check: typeof b.name === "string" ? b.name : "" });
      return Response.json({ ok: true, jobId: job.id });
    }
    return Response.json({ ok: true, folder, checks: await saveChecks(folder, b.checks) });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
