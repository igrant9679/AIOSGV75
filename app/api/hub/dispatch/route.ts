import { rankMachines } from "@/lib/dispatch";
import { asSessionTool } from "@/lib/sessionTools";

export const dynamic = "force-dynamic";

/** GET ?tool=claude|codex|hermes|acp&agent=<acp id>&project= → machines ranked for a new task. */
export async function GET(req: Request) {
  const u = new URL(req.url).searchParams;
  try {
    const candidates = await rankMachines({ tool: asSessionTool(u.get("tool")), agent: u.get("agent") || undefined, project: u.get("project") || undefined });
    return Response.json({ candidates });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
