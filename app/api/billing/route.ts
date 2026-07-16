import { readRegistry } from "@/lib/registry";
import { AGENT_DEFS } from "@/lib/agents-config";
import { billingFor, BILLING_LABEL, BILLING_NOTE, type BillingMode } from "@/lib/billing";

export const dynamic = "force-dynamic";

/**
 * GET — how every known agent is paid for, so cost surfaces can tell real
 * charges apart from subscription estimates.
 */
export async function GET() {
  const registry = await readRegistry();
  const llms = registry.llms.map((l) => ({ id: l.id, baseUrl: l.baseUrl }));
  const ids = [
    "claude",
    "auto",
    ...AGENT_DEFS.map((a) => a.id),
    ...registry.llms.map((l) => l.id),
    ...registry.commandAgents.map((a) => a.id),
  ];
  const modes: Record<string, BillingMode> = {};
  for (const id of [...new Set(ids)]) modes[id] = billingFor(id, llms);
  return Response.json({ modes, labels: BILLING_LABEL, notes: BILLING_NOTE });
}
