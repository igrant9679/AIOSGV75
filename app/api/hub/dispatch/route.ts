import { rankMachines } from "@/lib/dispatch";
import { asSessionTool } from "@/lib/sessionTools";

export const dynamic = "force-dynamic";

/** GET ?tool=claude|codex&project= → machines ranked for a new task. */
export async function GET(req: Request) {
  const u = new URL(req.url).searchParams;
  try {
    const candidates = await rankMachines({ tool: asSessionTool(u.get("tool")), project: u.get("project") || undefined });
    return Response.json({ candidates });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
