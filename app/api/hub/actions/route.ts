import os from "os";
import { readConfig } from "@/lib/cluster";
import { crossCheck, localLog, maybePublishLog, remoteLogs } from "@/lib/remoteLog";

export const dynamic = "force-dynamic";

/**
 * GET → Fleet → Remote actions: every machine's log of what other machines asked it to do (and
 * what it asked of them), merged one row per action, with requests a sender has no record of
 * sending flagged (lib/remoteLog.ts). This machine's log is read live, the others from the vault.
 * POST { action: "publish" } → share this machine's log now.
 */
export async function GET() {
  try {
    const cfg = await readConfig().catch(() => null);
    const label = cfg?.label || os.hostname();
    const [mine, others] = await Promise.all([localLog(label), remoteLogs()]);
    const rows = crossCheck([mine, ...others]);
    return Response.json({
      self: os.hostname(),
      machines: [mine, ...others].map((l) => ({ host: l.host, label: l.label, publishedAt: l.publishedAt, coversFrom: l.coversFrom, entries: l.entries.length })),
      rows: rows.slice(0, 400),
      unmatched: rows.filter((r) => r.unmatched).length,
    });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { action?: string };
  if (b.action !== "publish") return Response.json({ error: "unknown action" }, { status: 400 });
  const cfg = await readConfig().catch(() => null);
  await maybePublishLog(cfg?.label || os.hostname(), true);
  return Response.json({ ok: true });
}
