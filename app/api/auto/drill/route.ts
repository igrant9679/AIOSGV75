import { runAgentText } from "@/lib/runners";
import { routeTask } from "@/lib/router";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST { rungs?: 1 | 2 } — a failover drill for Auto.
 *
 * Asks Auto a tiny question while telling the agent it picks (and, with rungs 2,
 * the one it falls back to) to fail at once, so the ladder in runAgentText()
 * climbs exactly as it would if that agent were really down: next-cheapest
 * first, Claude last. The drill rides on this one call's options — no setting
 * changes, nothing else is affected, and a drilled failure is not recorded as
 * usage, so it cannot bench a healthy agent. One real answer is paid for: the
 * agent that ends up answering.
 */
const PROMPT = "Reply with the single word READY.";

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { rungs?: unknown };
  const rungs = b.rungs === 2 ? 2 : 1;
  const first = await routeTask(PROMPT);
  const fail = [first.agentId];
  let r = await runAgentText("auto", PROMPT, { injectMemory: false, drill: fail });
  if (rungs === 2 && r.routedTo && r.routedTo !== first.agentId && !r.error) {
    fail.push(r.routedTo);
    r = await runAgentText("auto", PROMPT, { injectMemory: false, drill: fail });
  }
  const ok = !r.error && !!r.routedTo && !fail.includes(r.routedTo);
  return Response.json({
    ok,
    firstPick: { id: first.agentId, name: first.agentName, reason: first.reason },
    failed: fail,
    answeredBy: r.routedTo,
    route: r.routeReason,
    answer: (r.text ?? "").trim().slice(0, 200),
    error: r.error,
    ms: r.ms,
  });
}
