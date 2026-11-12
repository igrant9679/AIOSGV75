import { askPermission, decideFleet, pendingFleet, waitForDecision, type HookAsk } from "@/lib/permissions";
import { readAlertSettings } from "@/lib/sessionEvents";

export const dynamic = "force-dynamic";

/**
 * Permission prompts (lib/permissions.ts).
 *   GET                → requests waiting on every LAN machine (for the UI)
 *   GET ?wait=<id>     → the hook's long poll: { status, output } once decided (≤25 s per call)
 *   POST {payload,…}   → from the hook: { id, waitMs } to wait for, or { skip }
 *   POST {action:"decide", host, id, behavior:"allow"|"deny", always?, message?}
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const wait = url.searchParams.get("wait");
  try {
    if (wait) {
      const r = await waitForDecision(wait);
      return r ? Response.json(r) : Response.json({ error: "unknown request" }, { status: 404 });
    }
    const [{ items, unreachable }, settings] = await Promise.all([pendingFleet(), readAlertSettings()]);
    return Response.json({ items, unreachable, mode: settings.permissions.mode, waitSeconds: settings.permissions.waitSeconds });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let body: HookAsk & { action?: string; host?: string; id?: string; behavior?: string; always?: boolean; message?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  try {
    if (body.action === "decide") {
      if (!body.id || (body.behavior !== "allow" && body.behavior !== "deny")) return Response.json({ error: "id and behavior required" }, { status: 400 });
      const r = await decideFleet(body.host ?? "", body.id, body.behavior, { always: body.always, message: body.message });
      return Response.json({ ok: true, request: r });
    }
    return Response.json(await askPermission(body));
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return Response.json({ error: (e as Error).message }, { status });
  }
}
