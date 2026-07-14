import { publishStatus, setWordPress, setGhost, setWebflow, type PublishTarget } from "@/lib/publish";

export const dynamic = "force-dynamic";

/** GET — redacted publishing-target status (sites/usernames but never secrets). */
export async function GET() {
  return Response.json(await publishStatus());
}

/**
 * POST — save one target's connection.
 * { target: "wordpress", site, username, appPassword }
 * { target: "ghost", site, adminApiKey }
 * { target: "webflow", token, collectionId, bodyField? }
 * (no target = wordpress, for backwards compatibility)
 */
export async function POST(request: Request) {
  const body = (await request.json()) as {
    target?: PublishTarget;
    site?: string;
    username?: string;
    appPassword?: string;
    adminApiKey?: string;
    token?: string;
    collectionId?: string;
    bodyField?: string;
  };
  const target = body.target ?? "wordpress";

  if (target === "ghost") {
    const site = (body.site ?? "").trim();
    const adminApiKey = (body.adminApiKey ?? "").trim();
    if (!/^https?:\/\/.+/i.test(site)) return Response.json({ error: "site must be a full https:// URL" }, { status: 400 });
    if (!/^[a-f0-9]+:[a-f0-9]+$/i.test(adminApiKey))
      return Response.json({ error: "Admin API key must look like id:secret (Ghost Settings → Integrations)" }, { status: 400 });
    await setGhost({ site, adminApiKey });
    return Response.json({ ok: true });
  }

  if (target === "webflow") {
    const token = (body.token ?? "").trim();
    const collectionId = (body.collectionId ?? "").trim();
    const bodyField = (body.bodyField ?? "post-body").trim();
    if (!token || !collectionId) return Response.json({ error: "API token and collection ID are required" }, { status: 400 });
    await setWebflow({ token, collectionId, bodyField });
    return Response.json({ ok: true });
  }

  const site = (body.site ?? "").trim();
  const username = (body.username ?? "").trim();
  const appPassword = (body.appPassword ?? "").trim();
  if (!/^https?:\/\/.+/i.test(site)) return Response.json({ error: "site must be a full https:// URL" }, { status: 400 });
  if (!username || !appPassword) return Response.json({ error: "username and application password are required" }, { status: 400 });
  await setWordPress({ site, username, appPassword });
  return Response.json({ ok: true });
}

/** DELETE ?target=wordpress|ghost|webflow — clear that stored connection. */
export async function DELETE(request: Request) {
  const target = (new URL(request.url).searchParams.get("target") ?? "wordpress") as PublishTarget;
  if (target === "ghost") await setGhost(null);
  else if (target === "webflow") await setWebflow(null);
  else await setWordPress(null);
  return Response.json({ ok: true });
}
