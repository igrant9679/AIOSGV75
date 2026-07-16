import { readState, scan, startDistill, resetProcessed, importAvailable, liveJob, type ImportState } from "@/lib/llmImport";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function summarize(state: ImportState, vaultOk: boolean) {
  const convos = state.conversations;
  const dates = convos.map((c) => c.createdAt).filter(Boolean);
  const processed = convos.filter((c) => c.processed).length;
  return {
    exportsDir: state.exportsDir,
    scannedAt: state.scannedAt,
    vaultOk,
    sources: state.sources,
    duplicates: state.duplicates ?? 0,
    warnings: state.warnings ?? [],
    total: convos.length,
    processed,
    messages: convos.reduce((n, c) => n + c.messageCount, 0),
    words: convos.reduce((n, c) => n + c.wordCount, 0),
    oldest: dates.length ? Math.min(...dates) : 0,
    newest: dates.length ? Math.max(...dates) : 0,
    job: liveJob(state.job),
    // a small sample (richest first) for the UI preview
    sample: [...convos]
      .sort((a, b) => b.messageCount - a.messageCount)
      .slice(0, 40)
      .map((c) => ({ id: c.id, source: c.source, title: c.title, messageCount: c.messageCount, createdAt: c.createdAt, processed: c.processed })),
  };
}

export async function GET() {
  return Response.json(summarize(await readState(), await importAvailable()));
}

export async function POST(request: Request) {
  const body = (await request.json()) as { action?: string; writer?: string; max?: number };
  try {
    if (body.action === "scan") return Response.json(summarize(await scan(), await importAvailable()));
    if (body.action === "distill") {
      // max 0 = distill EVERYTHING; otherwise clamp to 1..500 per run.
      const raw = Number(body.max);
      const max = Number.isFinite(raw) && raw <= 0 ? 0 : Math.max(1, Math.min(raw || 40, 500));
      const state = await startDistill(body.writer || "claude", max);
      return Response.json(summarize(state, await importAvailable()));
    }
    if (body.action === "reset") return Response.json(summarize(await resetProcessed(), await importAvailable()));
    return Response.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
