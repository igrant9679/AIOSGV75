import { modulesView, setModule } from "@/lib/modules";

export const dynamic = "force-dynamic";

/**
 * Modules (lib/modules.ts, rule 53): whole features switched on or off for every machine.
 * GET                    → { modules: [{ id, name, blurb, hrefs, duty?, on }] }
 * POST { id, on }        switch one (nothing is deleted)
 */
export async function GET() {
  return Response.json({ modules: modulesView() });
}
export async function POST(req: Request) {
  let b: { id?: string; on?: boolean };
  try {
    b = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  try {
    if (!b.id || typeof b.on !== "boolean") throw new Error("id and on required");
    return Response.json({ modules: await setModule(b.id, b.on) });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
