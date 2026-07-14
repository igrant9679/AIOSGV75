import { publishStatus, setWordPress } from "@/lib/publish";

export const dynamic = "force-dynamic";

/** GET — redacted publishing-target status (site/username but never the password). */
export async function GET() {
  return Response.json(await publishStatus());
}

/** POST { site, username, appPassword } — save the WordPress connection. */
export async function POST(request: Request) {
  const body = (await request.json()) as { site?: string; username?: string; appPassword?: string };
  const site = (body.site ?? "").trim();
  const username = (body.username ?? "").trim();
  const appPassword = (body.appPassword ?? "").trim();
  if (!/^https?:\/\/.+/i.test(site)) return Response.json({ error: "site must be a full https:// URL" }, { status: 400 });
  if (!username || !appPassword) return Response.json({ error: "username and application password are required" }, { status: 400 });
  await setWordPress({ site, username, appPassword });
  return Response.json({ ok: true });
}

/** DELETE — clear the stored WordPress connection. */
export async function DELETE() {
  await setWordPress(null);
  return Response.json({ ok: true });
}
