import { hookStatus, installHooks, removeHooks } from "@/lib/hooks";
import { readAlertSettings, writeAlertSettings, type AlertSettings } from "@/lib/sessionEvents";
import { buildDailySummary } from "@/lib/dailySummary";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET → shared alert settings + whether the hook is installed on THIS machine. */
export async function GET() {
  try {
    const [settings, hooks] = await Promise.all([readAlertSettings(), hookStatus()]);
    return Response.json({ settings, hooks });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

/**
 * { action: "settings", hooks?, longMinutes?, telegram?: { waiting?, longFinished?, daily?, permissions? },
 *   permissions?: { mode?: "off" | "app" | "all", waitSeconds? } }
 * { action: "install" | "remove" }        the hook on this machine only
 * { action: "summary", days?: number }     preview a daily summary (default: yesterday)
 */
export async function POST(req: Request) {
  let b: { action?: string; hooks?: unknown; longMinutes?: unknown; telegram?: Record<string, unknown>; permissions?: Record<string, unknown>; days?: number };
  try {
    b = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  try {
    if (b.action === "settings") {
      const telegram: Partial<AlertSettings["telegram"]> = {};
      if (b.telegram && typeof b.telegram === "object") {
        for (const k of ["waiting", "longFinished", "daily", "permissions"] as const) if (typeof b.telegram[k] === "boolean") telegram[k] = b.telegram[k] as boolean;
      }
      const permissions: Partial<AlertSettings["permissions"]> = {};
      if (b.permissions && typeof b.permissions === "object") {
        const m = b.permissions.mode;
        if (m === "off" || m === "app" || m === "all") permissions.mode = m;
        if (typeof b.permissions.waitSeconds === "number") permissions.waitSeconds = b.permissions.waitSeconds;
      }
      const patch: Omit<Partial<AlertSettings>, "telegram" | "permissions"> & { telegram?: Partial<AlertSettings["telegram"]>; permissions?: Partial<AlertSettings["permissions"]> } = { telegram, permissions };
      if (typeof b.hooks === "boolean") patch.hooks = b.hooks;
      if (typeof b.longMinutes === "number") patch.longMinutes = b.longMinutes;
      const settings = await writeAlertSettings(patch);
      return Response.json({ settings, hooks: await hookStatus() });
    }
    if (b.action === "install") return Response.json({ settings: await readAlertSettings(), hooks: await installHooks() });
    if (b.action === "remove") return Response.json({ settings: await readAlertSettings(), hooks: await removeHooks() });
    if (b.action === "summary") {
      const d = new Date();
      d.setDate(d.getDate() - Math.max(0, Math.min(Number(b.days ?? 1), 30)));
      return Response.json(await buildDailySummary(d));
    }
    return Response.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
