import os from "os";
import { readConfig } from "@/lib/cluster";
import { readPause, setPause } from "@/lib/fleetPause";
import { runHealthChecks } from "@/lib/health";

export const dynamic = "force-dynamic";

/** GET → the fleet pause as it stands (shared by every machine through the vault). */
export async function GET() {
  return Response.json(readPause());
}

/** { paused: boolean, hours?: number (0 or missing = until resumed), reason?: string } */
export async function POST(req: Request) {
  let b: { paused?: unknown; hours?: unknown; reason?: unknown };
  try {
    b = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (typeof b.paused !== "boolean") return Response.json({ error: "paused (true/false) required" }, { status: 400 });
  try {
    const cfg = await readConfig().catch(() => null);
    const p = await setPause(b.paused, {
      by: cfg?.label || os.hostname(),
      hours: typeof b.hours === "number" ? b.hours : undefined,
      reason: typeof b.reason === "string" ? b.reason : undefined,
    });
    void runHealthChecks().catch(() => {}); // Health shows it at once, here; the others within their next check
    return Response.json(p);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
