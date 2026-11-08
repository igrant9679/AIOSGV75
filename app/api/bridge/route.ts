import { bridgeTick, bridgeView, writeBridgeSettings, type BridgeSettings } from "@/lib/bridge";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Bridge status: folder, settings, recent tasks. */
export async function GET() {
  try {
    return Response.json(await bridgeView());
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

/**
 * { action: "settings", enabled?, requireApproval?, dailyLimit?, agent? }
 * { action: "run" } - process the inbox and rewrite Status.md now (master only)
 */
export async function POST(req: Request) {
  let body: Partial<BridgeSettings> & { action?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  try {
    if (body.action === "settings") {
      const patch: Partial<BridgeSettings> = {};
      if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
      if (typeof body.requireApproval === "boolean") patch.requireApproval = body.requireApproval;
      if (typeof body.dailyLimit === "number") patch.dailyLimit = body.dailyLimit;
      if (body.agent === "claude" || body.agent === "auto") patch.agent = body.agent;
      await writeBridgeSettings(patch);
      return Response.json(await bridgeView());
    }
    if (body.action === "run") {
      await bridgeTick(true);
      return Response.json(await bridgeView());
    }
    return Response.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
