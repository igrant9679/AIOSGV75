import fs from "fs/promises";
import path from "path";

/**
 * Publishing targets for the SEO Content pipeline. Currently WordPress via its
 * REST API + an Application Password (WP 5.6+). Credentials live in
 * data/publish.json (git-ignored) or the WP_* env vars as a fallback — same
 * pattern as lib/services.ts. Kept apart from the single-key services vault
 * because a WordPress connection is three fields, not one.
 */
export interface WordPressConfig {
  site: string; // e.g. https://blog.example.com
  username: string;
  appPassword: string;
}

const FILE = path.join(process.cwd(), "data", "publish.json");

interface Store {
  wordpress?: WordPressConfig;
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

/** Save (partial merge) or clear (null) the stored WordPress connection. */
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

export type PublishSource = "stored" | "env" | null;

/** Redacted status for the client — never returns the password. */
export async function publishStatus() {
  const store = await readStore();
  const stored = store.wordpress;
  const storedOk = Boolean(stored?.site && stored?.username && stored?.appPassword);
  const envOk = Boolean(process.env.WP_SITE && process.env.WP_USERNAME && process.env.WP_APP_PASSWORD);
  const active = await getWordPress();
  const source: PublishSource = storedOk ? "stored" : envOk ? "env" : null;
  return {
    wordpress: {
      configured: Boolean(active),
      source,
      site: active?.site ?? "",
      username: active?.username ?? "",
      stored: storedOk,
    },
  };
}

/** Create a WordPress post. Returns the live URL + id, or throws a clean error. */
export async function publishToWordPress(post: {
  title: string;
  content: string; // HTML
  excerpt?: string;
  slug?: string;
  status?: "draft" | "publish";
}): Promise<{ url: string; id: number }> {
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
  if (!res.ok) {
    let detail = "";
    try {
      const j = (await res.json()) as { message?: string; code?: string };
      detail = j.message || j.code || "";
    } catch {
      detail = (await res.text().catch(() => "")).slice(0, 200);
    }
    throw new Error(`WordPress error ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  const j = (await res.json()) as { id?: number; link?: string };
  return { url: j.link ?? `${cfg.site}/?p=${j.id ?? ""}`, id: j.id ?? 0 };
}
