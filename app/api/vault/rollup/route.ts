import { runRollup } from "@/lib/rollup";
import { indexCoverage } from "@/lib/vaultSearch";
import { vaultAvailable } from "@/lib/vault";

export const dynamic = "force-dynamic";

/**
 * GET  — what a roll-up pass WOULD do (nothing is written or moved), plus what
 *        the search index currently holds per folder.
 * POST — run a pass now: weekly notes, archive, conflict-copy sweep. The master
 *        does this by itself every few hours; this is for running it by hand.
 */
export async function GET() {
  if (!(await vaultAvailable())) return Response.json({ error: "vault not reachable" }, { status: 503 });
  return Response.json({ preview: await runRollup({ dryRun: true }), index: await indexCoverage() });
}

export async function POST() {
  if (!(await vaultAvailable())) return Response.json({ error: "vault not reachable" }, { status: 503 });
  return Response.json({ ok: true, result: await runRollup() });
}
