import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

/**
 * Publishing targets for the SEO Content pipeline: WordPress (REST +
 * Application Password), Ghost (Admin API, HS256 JWT from the id:secret key),
 * and Webflow (CMS API v2 collection items). Credentials live in
 * data/publish.json (git-ignored) with env-var fallbacks — same pattern as
 * lib/services.ts. Every target defaults to DRAFT so nothing goes live
 * unreviewed.
 */
export interface WordPressConfig {
  site: string; // e.g. https://blog.example.com
  username: string;
  appPassword: string;
}

export interface GhostConfig {
  site: string; // e.g. https://blog.ghost.io
  adminApiKey: string; // "id:secret" from Settings → Integrations → Admin API key
}

export interface WebflowConfig {
  token: string; // site token or OAuth bearer
  collectionId: string; // CMS collection to create items in
  bodyField: string; // slug of the rich-text field, e.g. "post-body"
}

export type PublishTarget = "wordpress" | "ghost" | "webflow";

const FILE = path.join(process.cwd(), "data", "publish.json");

interface Store {
  wordpress?: WordPressConfig;
  ghost?: GhostConfig;
  webflow?: WebflowConfig;
}

async function readStore(): Promise<Store> {
  try {
    const raw = JSON.parse(await fs.readFile(FILE, "utf8")) as Store;
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

async function writeStore(store: Store): Promise<void> {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(store, null, 2), "utf8");
}

function normalizeSite(site: string): string {
  return site.trim().replace(/\/+$/, "");
}

/** Resolve a usable WordPress connection: stored config wins, else WP_* env. */
export async function getWordPress(): Promise<WordPressConfig | null> {
  const stored = (await readStore()).wordpress;
  if (stored?.site && stored.username && stored.appPassword) return stored;
  const site = process.env.WP_SITE;
  const username = process.env.WP_USERNAME;
  const appPassword = process.env.WP_APP_PASSWORD;
  if (site && username && appPassword) return { site: normalizeSite(site), username, appPassword };
  return null;
}

export async function getGhost(): Promise<GhostConfig | null> {
  const stored = (await readStore()).ghost;
  if (stored?.site && stored.adminApiKey) return stored;
  const site = process.env.GHOST_SITE;
  const adminApiKey = process.env.GHOST_ADMIN_API_KEY;
  if (site && adminApiKey) return { site: normalizeSite(site), adminApiKey };
  return null;
}

export async function getWebflow(): Promise<WebflowConfig | null> {
  const stored = (await readStore()).webflow;
  if (stored?.token && stored.collectionId) return stored;
  const token = process.env.WEBFLOW_TOKEN;
  const collectionId = process.env.WEBFLOW_COLLECTION_ID;
  if (token && collectionId) {
    return { token, collectionId, bodyField: process.env.WEBFLOW_BODY_FIELD || "post-body" };
  }
  return null;
}

/** Save (or clear with null) one target's stored connection. */
export async function setWordPress(cfg: WordPressConfig | null): Promise<void> {
  const store = await readStore();
  if (!cfg) delete store.wordpress;
  else
    store.wordpress = {
      site: normalizeSite(cfg.site),
      username: cfg.username.trim(),
      appPassword: cfg.appPassword.trim(),
    };
  await writeStore(store);
}

export async function setGhost(cfg: GhostConfig | null): Promise<void> {
  const store = await readStore();
  if (!cfg) delete store.ghost;
  else store.ghost = { site: normalizeSite(cfg.site), adminApiKey: cfg.adminApiKey.trim() };
  await writeStore(store);
}

export async function setWebflow(cfg: WebflowConfig | null): Promise<void> {
  const store = await readStore();
  if (!cfg) delete store.webflow;
  else
    store.webflow = {
      token: cfg.token.trim(),
      collectionId: cfg.collectionId.trim(),
      bodyField: (cfg.bodyField || "post-body").trim(),
    };
  await writeStore(store);
}

export type PublishSource = "stored" | "env" | null;

/** Redacted status for the client — never returns secrets. */
export async function publishStatus() {
  const store = await readStore();

  const wpStored = Boolean(store.wordpress?.site && store.wordpress?.username && store.wordpress?.appPassword);
  const wpEnv = Boolean(process.env.WP_SITE && process.env.WP_USERNAME && process.env.WP_APP_PASSWORD);
  const wp = await getWordPress();

  const ghStored = Boolean(store.ghost?.site && store.ghost?.adminApiKey);
  const ghEnv = Boolean(process.env.GHOST_SITE && process.env.GHOST_ADMIN_API_KEY);
  const gh = await getGhost();

  const wfStored = Boolean(store.webflow?.token && store.webflow?.collectionId);
  const wfEnv = Boolean(process.env.WEBFLOW_TOKEN && process.env.WEBFLOW_COLLECTION_ID);
  const wf = await getWebflow();

  return {
    wordpress: {
      configured: Boolean(wp),
      source: (wpStored ? "stored" : wpEnv ? "env" : null) as PublishSource,
      site: wp?.site ?? "",
      username: wp?.username ?? "",
      stored: wpStored,
    },
    ghost: {
      configured: Boolean(gh),
      source: (ghStored ? "stored" : ghEnv ? "env" : null) as PublishSource,
      site: gh?.site ?? "",
      stored: ghStored,
    },
    webflow: {
      configured: Boolean(wf),
      source: (wfStored ? "stored" : wfEnv ? "env" : null) as PublishSource,
      collectionId: wf?.collectionId ?? "",
      bodyField: wf?.bodyField ?? "post-body",
      stored: wfStored,
    },
  };
}

async function errorDetail(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { message?: string; code?: string; errors?: { message?: string }[] };
    return j.message || j.errors?.[0]?.message || j.code || "";
  } catch {
    return (await res.text().catch(() => "")).slice(0, 200);
  }
}

export interface PostPayload {
  title: string;
  content: string; // HTML
  excerpt?: string;
  slug?: string;
  status?: "draft" | "publish";
}

/** Create a WordPress post. Returns the URL + id, or throws a clean error. */
export async function publishToWordPress(post: PostPayload): Promise<{ url: string; id: string }> {
  const cfg = await getWordPress();
  if (!cfg) throw new Error("No WordPress connection — add one in Settings → Publishing.");
  const auth = Buffer.from(`${cfg.username}:${cfg.appPassword}`).toString("base64");
  const res = await fetch(`${cfg.site}/wp-json/wp/v2/posts`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
    body: JSON.stringify({
      title: post.title,
      content: post.content,
      excerpt: post.excerpt ?? "",
      slug: post.slug,
      status: post.status ?? "draft",
    }),
  });
  if (!res.ok) throw new Error(`WordPress error ${res.status}: ${await errorDetail(res)}`);
  const j = (await res.json()) as { id?: number; link?: string };
  return { url: j.link ?? `${cfg.site}/?p=${j.id ?? ""}`, id: String(j.id ?? "") };
}

/** Ghost Admin API auth: short-lived HS256 JWT signed with the key's hex secret. */
function ghostToken(adminApiKey: string): string {
  const [id, secret] = adminApiKey.split(":");
  if (!id || !secret) throw new Error("Ghost Admin API key must look like id:secret (Settings → Integrations).");
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const iat = Math.floor(Date.now() / 1000);
  const header = b64({ alg: "HS256", typ: "JWT", kid: id });
  const payload = b64({ iat, exp: iat + 300, aud: "/admin/" });
  const signature = crypto
    .createHmac("sha256", Buffer.from(secret, "hex"))
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}

/** Create a Ghost post (draft by default) via the Admin API. */
export async function publishToGhost(post: PostPayload): Promise<{ url: string; id: string }> {
  const cfg = await getGhost();
  if (!cfg) throw new Error("No Ghost connection — add one in Settings → Publishing.");
  const res = await fetch(`${cfg.site}/ghost/api/admin/posts/?source=html`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Ghost ${ghostToken(cfg.adminApiKey)}` },
    body: JSON.stringify({
      posts: [
        {
          title: post.title,
          html: post.content,
          custom_excerpt: (post.excerpt ?? "").slice(0, 300),
          slug: post.slug,
          status: post.status === "publish" ? "published" : "draft",
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Ghost error ${res.status}: ${await errorDetail(res)}`);
  const j = (await res.json()) as { posts?: { id?: string; url?: string; slug?: string }[] };
  const p = j.posts?.[0];
  return { url: p?.url ?? `${cfg.site}/${p?.slug ?? ""}`, id: p?.id ?? "" };
}

/** Create a Webflow CMS item (draft unless status=publish) via API v2. */
export async function publishToWebflow(post: PostPayload): Promise<{ url: string; id: string }> {
  const cfg = await getWebflow();
  if (!cfg) throw new Error("No Webflow connection — add one in Settings → Publishing.");
  const res = await fetch(`https://api.webflow.com/v2/collections/${cfg.collectionId}/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.token}` },
    body: JSON.stringify({
      isArchived: false,
      isDraft: post.status !== "publish",
      fieldData: {
        name: post.title,
        slug: post.slug,
        [cfg.bodyField]: post.content,
      },
    }),
  });
  if (!res.ok) throw new Error(`Webflow error ${res.status}: ${await errorDetail(res)}`);
  const j = (await res.json()) as { id?: string };
  // Webflow doesn't return a page URL for CMS items — the designer binds them.
  return { url: "", id: j.id ?? "" };
}

/** Dispatch a post to the chosen target. */
export async function publishTo(target: PublishTarget, post: PostPayload): Promise<{ url: string; id: string }> {
  if (target === "ghost") return publishToGhost(post);
  if (target === "webflow") return publishToWebflow(post);
  return publishToWordPress(post);
}
