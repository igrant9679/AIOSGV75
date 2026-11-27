import os from "os";
import { acpOverview, readAcpAgents, saveAcpAgents } from "@/lib/acpAgents";
import { probeAcp } from "@/lib/acpClient";
import { readFallback, saveFallback, stepLabels, stepReady } from "@/lib/fallback";
import { sessionsSnapshot } from "@/lib/sessions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Fleet → Agents & fallback, for THIS machine only (another machine can't change either: the
 * agents' commands and the fallback order are this machine's own, like its check commands).
 *
 * GET  → { acp: { agents, presets }, fallback: { enabled, order }, steps: [{ step, label, ok, why }] }
 * POST { action: "acp", agents: [...] }            replace this machine's ACP agent list
 * POST { action: "acp-test", id }                  handshake with one agent (no prompt is sent)
 * POST { action: "fallback", enabled?, order? }    the "when a plan hits its limit" setting
 */
export async function GET() {
  try {
    const [acp, fallback, labels, snap] = await Promise.all([acpOverview(), readFallback(), stepLabels(), sessionsSnapshot()]);
    const candidates = [...new Set(["claude", "codex", "local", "hermes", ...acp.agents.map((a) => `acp:${a.id}`), ...fallback.order])];
    const steps = await Promise.all(candidates.map(async (step) => ({ step, label: labels[step] ?? step, ...(await stepReady(step, snap.subscriptions)) })));
    return Response.json({ acp, fallback, steps });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let b: { action?: string; agents?: unknown; id?: string; enabled?: unknown; order?: unknown };
  try {
    b = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  try {
    if (b.action === "acp") return Response.json({ agents: await saveAcpAgents(b.agents) });
    if (b.action === "acp-test") {
      const a = (await readAcpAgents()).find((x) => x.id === b.id);
      if (!a) return Response.json({ error: "No agent with that id here." }, { status: 404 });
      return Response.json(await probeAcp(a, os.homedir()));
    }
    if (b.action === "fallback") {
      return Response.json({ fallback: await saveFallback({ enabled: typeof b.enabled === "boolean" ? b.enabled : undefined, order: Array.isArray(b.order) ? (b.order as string[]) : undefined }) });
    }
    return Response.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
