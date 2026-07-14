import fs from "fs/promises";
import path from "path";

/**
 * External service credentials — the API keys for paid creative providers
 * (image / voice / video) that power the Studio. Kept SEPARATE from the LLM
 * registry because these aren't chat agents; they're one key per vendor.
 *
 * Stored in data/services.json (git-ignored, like registry.json — the whole
 * data/ dir is ignored). A key set in the environment (.env.local) is used as
 * a fallback so the same install works whether the operator prefers the UI or
 * a dotfile. Keys NEVER leave the server — the API only exposes "configured".
 */
export type ServiceCategory = "image" | "voice" | "video";

export interface ServiceCatalogEntry {
  id: string;
  label: string;
  blurb: string;
  categories: ServiceCategory[];
  /** .env.local variable checked as a fallback when nothing is stored. */
  envVar: string;
  /** Where the operator gets a key. */
  keyHint: string;
  /** Cosmetic placeholder hinting at the key shape. */
  keyPrefix: string;
}

export const SERVICE_CATALOG: ServiceCatalogEntry[] = [
  {
    id: "openai",
    label: "OpenAI",
    blurb: "One key powers both image generation (gpt-image-1 / DALL·E 3) and text-to-speech.",
    categories: ["image", "voice"],
    envVar: "OPENAI_API_KEY",
    keyHint: "platform.openai.com/api-keys",
    keyPrefix: "sk-…",
  },
  {
    id: "google",
    label: "Google Gemini",
    blurb: "Image generation with Gemini 2.5 Flash Image (“Nano Banana”) — fast and low-cost.",
    categories: ["image"],
    envVar: "GEMINI_API_KEY",
    keyHint: "aistudio.google.com/apikey",
    keyPrefix: "AIza…",
  },
  {
    id: "elevenlabs",
    label: "ElevenLabs",
    blurb: "Premium, lifelike voices — the best-in-class text-to-speech option.",
    categories: ["voice"],
    envVar: "ELEVENLABS_API_KEY",
    keyHint: "elevenlabs.io → Profile → API Keys",
    keyPrefix: "sk_… / xi-…",
  },
  {
    id: "replicate",
    label: "Replicate",
    blurb: "Text-to-video (and thousands of other models) run on demand, billed per second.",
    categories: ["video"],
    envVar: "REPLICATE_API_TOKEN",
    keyHint: "replicate.com/account/api-tokens",
    keyPrefix: "r8_…",
  },
];

export function serviceById(id: string): ServiceCatalogEntry | undefined {
  return SERVICE_CATALOG.find((s) => s.id === id);
}

/** Providers that can serve a given Studio category. */
export function providersFor(category: ServiceCategory): ServiceCatalogEntry[] {
  return SERVICE_CATALOG.filter((s) => s.categories.includes(category));
}

const FILE = path.join(process.cwd(), "data", "services.json");

type KeyStore = Record<string, string>;

async function readStore(): Promise<KeyStore> {
  try {
    const raw = JSON.parse(await fs.readFile(FILE, "utf8")) as KeyStore;
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

async function writeStore(store: KeyStore): Promise<void> {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(store, null, 2), "utf8");
}

/** Resolve a usable key: stored value wins, else the env-var fallback, else "". */
export async function getServiceKey(id: string): Promise<string> {
  const store = await readStore();
  const stored = (store[id] ?? "").trim();
  if (stored) return stored;
  const entry = serviceById(id);
  const env = entry ? (process.env[entry.envVar] ?? "").trim() : "";
  return env;
}

export async function hasServiceKey(id: string): Promise<boolean> {
  return Boolean(await getServiceKey(id));
}

export type KeySource = "stored" | "env" | null;

/** Where a service's key comes from, without revealing it. */
export async function keySource(id: string): Promise<KeySource> {
  const store = await readStore();
  if ((store[id] ?? "").trim()) return "stored";
  const entry = serviceById(id);
  if (entry && (process.env[entry.envVar] ?? "").trim()) return "env";
  return null;
}

/** Set (non-empty) or clear (empty) a stored key. Env fallbacks are untouched. */
export async function setServiceKey(id: string, apiKey: string): Promise<void> {
  if (!serviceById(id)) throw new Error(`unknown service: ${id}`);
  const store = await readStore();
  const trimmed = apiKey.trim();
  if (trimmed) store[id] = trimmed.slice(0, 400);
  else delete store[id];
  await writeStore(store);
}

/** Redacted view for the client: catalog + whether each service is ready. */
export async function serviceStatus() {
  const store = await readStore();
  return Promise.all(
    SERVICE_CATALOG.map(async (s) => ({
      ...s,
      source: await keySource(s.id),
      configured: Boolean(await getServiceKey(s.id)),
      stored: Boolean((store[s.id] ?? "").trim()),
    })),
  );
}
