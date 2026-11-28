import { connectionsView, deleteSubscription, saveSubscription } from "@/lib/connections";

export const dynamic = "force-dynamic";

/**
 * Connections (lib/connections.ts, rule 51): sign-ins per machine, models, services and subscriptions.
 * GET                                         → { signins[], models[], services[], machines[], subscriptions[] } (never a key's value)
 * POST { action: "sub-save", subscription }   add or change what a plan costs and when it renews
 * POST { action: "sub-delete", id }
 */
export async function GET() {
  try {
    return Response.json(await connectionsView());
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
export async function POST(req: Request) {
  let b: { action?: string; id?: string; subscription?: unknown };
  try {
    b = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  try {
    if (b.action === "sub-save") return Response.json({ subscriptions: await saveSubscription(b.subscription) });
    if (b.action === "sub-delete" && b.id) return Response.json({ subscriptions: await deleteSubscription(b.id) });
    return Response.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
