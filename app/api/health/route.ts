import { healthSnapshot, runHealthChecks, setHealthSettings } from "@/lib/health";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Latest health report for this machine (re-checks when older than 10 min). */
export async function GET() {
  try {
    return Response.json(await healthSnapshot());
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

/**
 * { action: "run" } — re-check now
 * { action: "settings", telegram: boolean } — Telegram alerts on/off
 */
export async function POST(req: Request) {
  let body: { action?: string; telegram?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  try {
    if (body.action === "run") {
      await runHealthChecks();
      return Response.json(await healthSnapshot());
    }
    if (body.action === "settings" && typeof body.telegram === "boolean") {
      await setHealthSettings({ telegram: body.telegram });
      await runHealthChecks(); // reflect the change (and send current failures once if just turned on)
      return Response.json(await healthSnapshot());
    }
    return Response.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
