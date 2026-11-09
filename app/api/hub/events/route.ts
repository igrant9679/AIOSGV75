import { dismissEvents, ingestHook } from "@/lib/sessionEvents";
import { fleetEvents } from "@/lib/fleetLive";

export const dynamic = "force-dynamic";

/** GET → { needs, recent, settings } across every machine. */
export async function GET() {
  try {
    return Response.json(await fleetEvents());
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

/**
 * From scripts/mc-hook.mjs: { source: "claude" | "codex", payload, at }
 * From the UI:              { action: "dismiss", ids: [...] }
 */
export async function POST(req: Request) {
  let b: { action?: string; ids?: unknown; source?: string; payload?: Record<string, unknown>; at?: number };
  try {
    b = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  try {
    if (b.action === "dismiss") {
      const ids = Array.isArray(b.ids) ? (b.ids as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 200) : [];
      await dismissEvents(ids);
      return Response.json({ ok: true });
    }
    const ev = await ingestHook(b);
    return Response.json({ ok: true, event: ev?.id ?? null });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
