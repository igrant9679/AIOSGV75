import { readConfig } from "@/lib/cluster";
import { clearFleetLook, pushFleetLook, readFleetLook } from "@/lib/fleetLook";

export const dynamic = "force-dynamic";

/**
 * The fleet look (lib/fleetLook.ts): one appearance pushed to every machine through the vault.
 * GET                                              → { look | null }   (?meta=1: without the look itself)
 * POST { action: "push", appearance, theme?, custom, name? }
 * POST { action: "clear" }                         stop sharing (browsers keep what they have)
 */
export async function GET(req: Request) {
  const look = readFleetLook();
  if (new URL(req.url).searchParams.get("meta") === "1") return Response.json({ look: look ? { version: look.version, at: look.at, by: look.by, name: look.name } : null });
  return Response.json({ look });
}

export async function POST(req: Request) {
  let b: { action?: string; appearance?: unknown; theme?: unknown; custom?: unknown; name?: unknown };
  try {
    b = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  try {
    if (b.action === "push") {
      const cfg = await readConfig().catch(() => null);
      const look = await pushFleetLook({ appearance: b.appearance, theme: b.theme, custom: b.custom, name: b.name, by: cfg?.label || "this machine" });
      return Response.json({ ok: true, version: look.version });
    }
    if (b.action === "clear") {
      await clearFleetLook();
      return Response.json({ ok: true });
    }
    return Response.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
