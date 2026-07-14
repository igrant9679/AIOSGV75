import { REPORT_DEFS, buildReport, saveReportToVault } from "@/lib/reports";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET — the report catalog; GET ?id= — one fully built report. */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ reports: REPORT_DEFS });
  const report = await buildReport(id);
  if (!report) return Response.json({ error: "unknown report" }, { status: 404 });
  return Response.json({ report });
}

/** POST { id, action: "vault" } — save the report as a note in Agentic OS/Reports/. */
export async function POST(request: Request) {
  const body = (await request.json()) as { id?: string; action?: string };
  if (body.action !== "vault" || !body.id) return Response.json({ error: "expected { id, action: \"vault\" }" }, { status: 400 });
  const report = await buildReport(body.id);
  if (!report) return Response.json({ error: "unknown report" }, { status: 404 });
  try {
    const file = await saveReportToVault(report);
    return Response.json({ ok: true, file });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
