import { rankMachines } from "@/lib/dispatch";

export const dynamic = "force-dynamic";

/** GET ?tool=claude|codex&project= → machines ranked for a new task. */
export async function GET(req: Request) {
  const u = new URL(req.url).searchParams;
  try {
    const candidates = await rankMachines({ tool: u.get("tool") === "codex" ? "codex" : "claude", project: u.get("project") || undefined });
    return Response.json({ candidates });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
