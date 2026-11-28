import { allTools, deleteCustomTool, deleteResult, localSkills, runSkill, runTool, saveCustomTool, settleResults } from "@/lib/toolsLibrary";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The Tools library (lib/toolsLibrary.ts, rule 52): forms that produce a finished piece of writing.
 * GET                                              → { tools[], skills[], results[] }
 * POST { action: "run", id, values, engine? }      fill the form, ask a model, keep the result
 * POST { action: "run-skill", name, input }        run a Claude skill on this machine (answer only)
 * POST { action: "save-tool", tool } | { action: "delete-tool", id } | { action: "delete-result", id }
 */
export async function GET() {
  try {
    return Response.json({ tools: allTools(), skills: localSkills(), results: await settleResults() });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
export async function POST(req: Request) {
  let b: { action?: string; id?: string; name?: string; input?: string; values?: Record<string, unknown>; engine?: string; tool?: unknown };
  try {
    b = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  try {
    switch (b.action) {
      case "run":
        return Response.json({ result: await runTool(String(b.id ?? ""), b.values ?? {}, b.engine) });
      case "run-skill":
        return Response.json({ result: await runSkill(String(b.name ?? ""), String(b.input ?? "")) });
      case "save-tool":
        return Response.json({ tool: await saveCustomTool(b.tool) });
      case "delete-tool":
        await deleteCustomTool(String(b.id ?? ""));
        return Response.json({ ok: true });
      case "delete-result":
        await deleteResult(String(b.id ?? ""));
        return Response.json({ ok: true });
      default:
        return Response.json({ error: "unknown action" }, { status: 400 });
    }
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
