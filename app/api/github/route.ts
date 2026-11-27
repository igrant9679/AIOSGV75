import { ghAccounts } from "@/lib/github";
import { readGithubProgress, readGithubReport, refreshGithubReport } from "@/lib/githubReport";

export const dynamic = "force-dynamic";

/**
 * The GitHub dashboard (lib/githubReport.ts).
 * GET                                → { report, progress, signin: { installed, accounts, note } }
 * POST { action: "refresh", days }   → start a new report (7, 14 or 30 days) in the background
 */
export async function GET() {
  try {
    const [report, progress, signin] = [await readGithubReport(), readGithubProgress(), ghAccounts()];
    return Response.json({ report, progress, signin });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let b: { action?: string; days?: number };
  try {
    b = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (b.action !== "refresh") return Response.json({ error: "unknown action" }, { status: 400 });
  if (readGithubProgress()?.running) return Response.json({ error: "A report is already being made." }, { status: 409 });
  // runs on after this answer; the page follows it through the progress file
  void refreshGithubReport(Number(b.days) || 7).catch((e: Error) => console.error(`[mission-control] github report: ${e.message}`));
  await new Promise((r) => setTimeout(r, 300));
  return Response.json({ ok: true, progress: readGithubProgress() });
}
