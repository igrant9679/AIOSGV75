import { TALOS_GUIDE, askFleet, buildManual, cardText, commandFleet, confirmCard, makeCard, recentCards, talosGet } from "@/lib/talos";
import { buildSnapshot } from "@/lib/fleetSnapshot";
import { readTalosSettings, saveTalosSettings } from "@/lib/talosNotify";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Talos (OpenClaw on Telegram) controls Mission Control, rule 47 (lib/talos.ts):
 * GET  ?what=guide | manual | snapshot | cards | settings
 * POST { op: "ask", question }                                   a plain answer about the fleet
 * POST { op: "command", text, history? }                         any request in plain words → { say } or { say, card } (JARVIS)
 * POST { op: "get", path, host? }                                read any GET endpoint (here or on another machine)
 * POST { op: "act", method, path, body?, host?, summary }        → a confirm card for the owner (nothing runs yet)
 * POST { op: "confirm", id, reply }                              the owner's reply: yes runs it once, anything else cancels
 * POST { op: "settings", … }                                     notifications / digest / failover (lib/talosNotify.ts)
 */
export async function GET(req: Request) {
  const what = new URL(req.url).searchParams.get("what") ?? "guide";
  try {
    if (what === "guide") return Response.json({ guide: TALOS_GUIDE });
    if (what === "manual") return Response.json({ guide: TALOS_GUIDE, endpoints: buildManual() });
    if (what === "snapshot") return Response.json(await buildSnapshot());
    if (what === "cards") return Response.json({ cards: await recentCards() });
    if (what === "settings") return Response.json({ settings: await readTalosSettings() });
    return Response.json({ error: "unknown what" }, { status: 400 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  try {
    switch (b.op) {
      case "ask":
        return Response.json(await askFleet(String(b.question ?? "")));
      case "command":
        return Response.json(await commandFleet(String(b.text ?? ""), Array.isArray(b.history) ? (b.history as { who: string; text: string }[]) : []));
      case "get":
        return Response.json({ data: await talosGet(b.path, b.host) });
      case "act": {
        const card = await makeCard(b);
        return Response.json({ card: { id: card.id, expiresAt: card.expiresAt, host: card.hostLabel }, text: cardText(card) });
      }
      case "confirm": {
        const card = await confirmCard(String(b.id ?? ""), String(b.reply ?? ""));
        return Response.json({ status: card.status, result: card.result, error: card.error });
      }
      case "settings":
        return Response.json({ settings: await saveTalosSettings(b) });
      default:
        return Response.json({ error: "unknown op" }, { status: 400 });
    }
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
