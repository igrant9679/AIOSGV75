import { deleteAgent, readAgents, runAgent, saveAgent, setAgentEnabled } from "@/lib/fleetAgents";
import { AGENT_TEMPLATES } from "@/lib/fleetAgentRules";
import { rankMachines } from "@/lib/dispatch";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Fleet agents (lib/fleetAgents.ts, rule 50): the owner's own standing agents.
 * GET                                      → { agents[], templates[], machines[] }
 * POST { action: "save", agent }           create or change one (agent.id present = change)
 * POST { action: "delete", id } | { action: "enable", id, enabled }
 * POST { action: "run", id, note? }        start one run now
 */
export async function GET() {
  try {
    const machines = await rankMachines({ tool: "claude" }).catch(() => []);
    return Response.json({ agents: readAgents(), templates: AGENT_TEMPLATES, machines: machines.map((m) => ({ host: m.host, label: m.label, ok: m.ok, why: m.ok ? m.reasons[0] : m.blocked })) });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let b: { action?: string; id?: string; agent?: unknown; enabled?: boolean; note?: string };
  try {
    b = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  try {
    switch (b.action) {
      case "save":
        return Response.json({ agent: await saveAgent(b.agent) });
      case "delete":
        if (!b.id) throw new Error("Which agent?");
        await deleteAgent(b.id);
        return Response.json({ ok: true });
      case "enable":
        if (!b.id) throw new Error("Which agent?");
        await setAgentEnabled(b.id, b.enabled !== false);
        return Response.json({ ok: true });
      case "run":
        if (!b.id) throw new Error("Which agent?");
        return Response.json({ run: await runAgent(b.id, { note: typeof b.note === "string" ? b.note.slice(0, 2000) : undefined }) });
      default:
        return Response.json({ error: "unknown action" }, { status: 400 });
    }
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
