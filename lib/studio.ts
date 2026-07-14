import fs from "fs/promises";
import path from "path";
import { vaultInfo, vaultAvailable } from "./vault";
import { getServiceKey } from "./services";
import { recordUsage } from "./usage";

/**
 * Creative Studio — image / voice / video generation via paid provider APIs.
 * Outputs land in the vault under "Agentic OS/Studio/{images,audio,video}/" so
 * the gallery syncs across machines like the rest of the brain; the index sits
 * beside them (studio.json). Image + voice run inline; video is async (a
 * Replicate prediction) and is polled forward on every list().
 *
 * Providers are gated on a stored/env key (lib/services.ts). With no key the
 * request is rejected early with a clear message — the UI routes the operator
 * to Settings → API Keys.
 */
export type StudioKind = "image" | "voice" | "video";

export interface StudioItem {
  id: string;
  kind: StudioKind;
  prompt: string;
  provider: string;
  model: string;
  file: string; // filename inside the kind's subfolder
  mime: string;
  status: "generating" | "done" | "error";
  error?: string;
  meta: {
    size?: string;
    voice?: string;
    quality?: string;
    bytes?: number;
    predictionId?: string;
  };
  costUsd?: number;
  createdAt: number;
}

const MAX_ITEMS = 200;
const STALE_MS = 15 * 60_000;
const live = new Map<string, StudioItem>();
let seq = 0;

const SUBDIR: Record<StudioKind, string> = { image: "images", voice: "audio", video: "video" };
const EXT: Record<StudioKind, string> = { image: "png", voice: "mp3", video: "mp4" };
const MIME: Record<StudioKind, string> = { image: "image/png", voice: "audio/mpeg", video: "video/mp4" };

// Rough cost estimates (USD) so the usage ledger/analytics reflect spend.
const COST: Record<string, number> = { "studio:image": 0.04, "studio:voice": 0.015, "studio:video": 0.5 };

function studioDir(): string {
  return path.join(vaultInfo().base, "Studio");
}
function indexFile(): string {
  return path.join(studioDir(), "studio.json");
}
function kindDir(kind: StudioKind): string {
  return path.join(studioDir(), SUBDIR[kind]);
}

function slugify(text: string): string {
  return text.slice(0, 48).replace(/[^a-z0-9 ]/gi, "").trim().replace(/\s+/g, "-").toLowerCase() || "clip";
}

async function readIndex(): Promise<StudioItem[]> {
  try {
    return JSON.parse(await fs.readFile(indexFile(), "utf8")) as StudioItem[];
  } catch {
    return [];
  }
}

async function saveItem(item: StudioItem): Promise<void> {
  const disk = await readIndex();
  const i = disk.findIndex((x) => x.id === item.id);
  if (i >= 0) disk[i] = item;
  else disk.unshift(item);
  await fs.mkdir(studioDir(), { recursive: true });
  await fs.writeFile(indexFile(), JSON.stringify(disk.slice(0, MAX_ITEMS), null, 2), "utf8");
}

async function writeMedia(item: StudioItem, bytes: Buffer): Promise<void> {
  const file = `${item.kind}-${slugify(item.prompt)}-${item.id.slice(-4)}.${EXT[item.kind]}`;
  await fs.mkdir(kindDir(item.kind), { recursive: true });
  await fs.writeFile(path.join(kindDir(item.kind), file), bytes);
  item.file = file;
  item.mime = MIME[item.kind];
  item.meta.bytes = bytes.byteLength;
}

function newItem(kind: StudioKind, prompt: string, provider: string, model: string): StudioItem {
  return {
    id: `sd-${Date.now().toString(36)}-${seq++}`,
    kind,
    prompt: prompt.slice(0, 2000),
    provider,
    model,
    file: "",
    mime: MIME[kind],
    status: "generating",
    meta: {},
    createdAt: Date.now(),
  };
}

async function finish(item: StudioItem, start: number, ok: boolean): Promise<StudioItem> {
  await saveItem(item);
  live.delete(item.id);
  if (ok) item.costUsd = COST[`studio:${item.kind}`] ?? 0;
  await recordUsage({
    ts: Date.now(),
    agent: `studio:${item.kind}`,
    kind: "system",
    ms: Date.now() - start,
    costUsd: ok ? COST[`studio:${item.kind}`] : undefined,
    ok,
  });
  return item;
}

// ─── Image (OpenAI Images or Google Gemini — different APIs, one entry point) ───
function defaultImageModel(provider: string): string {
  return provider === "google" ? "gemini-2.5-flash-image" : "gpt-image-1";
}

export async function generateImage(opts: {
  prompt: string;
  provider?: string;
  model?: string;
  size?: string;
  quality?: string;
  aspect?: string;
}): Promise<StudioItem> {
  const provider = opts.provider || "openai";
  const model = opts.model || defaultImageModel(provider);
  const item = newItem("image", opts.prompt, provider, model);
  const start = Date.now();
  live.set(item.id, item);
  try {
    const key = await getServiceKey(provider);
    if (!key) throw new Error(`No ${provider} key — add one in Settings → API Keys.`);
    const bytes = provider === "google" ? await geminiImage(key, model, opts.prompt, opts.aspect) : await openaiImage(key, model, opts, item);
    if (provider === "google") item.meta.size = opts.aspect || "1:1";
    await writeMedia(item, bytes);
    item.status = "done";
  } catch (e) {
    item.status = "error";
    item.error = (e as Error).message;
  }
  return finish(item, start, item.status === "done");
}

// OpenAI: gpt-image-1 returns b64 + takes `quality`; DALL·E needs response_format asked for.
async function openaiImage(
  key: string,
  model: string,
  opts: { prompt: string; size?: string; quality?: string },
  item: StudioItem,
): Promise<Buffer> {
  const body: Record<string, unknown> = { model, prompt: opts.prompt, size: opts.size || "1024x1024", n: 1 };
  if (model.startsWith("dall-e")) body.response_format = "b64_json";
  else body.quality = opts.quality || "medium";
  item.meta.size = String(body.size);
  if (body.quality) item.meta.quality = String(body.quality);

  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await providerError(res, "openai"));
  const j = (await res.json()) as { data?: { b64_json?: string }[] };
  const b64 = j.data?.[0]?.b64_json;
  if (!b64) throw new Error("provider returned no image data");
  return Buffer.from(b64, "base64");
}

// Gemini: generateContent returns the image inline as base64 in a content part.
async function geminiImage(key: string, model: string, prompt: string, aspect?: string): Promise<Buffer> {
  const generationConfig: Record<string, unknown> = {};
  // gemini-2.5-flash-image takes aspect ratio via imageConfig (e.g. "16:9").
  if (aspect) generationConfig.imageConfig = { aspectRatio: aspect };
  // The older preview image model must be told to emit an image modality.
  if (/preview-image-generation/i.test(model)) generationConfig.responseModalities = ["TEXT", "IMAGE"];
  const body: Record<string, unknown> = { contents: [{ parts: [{ text: prompt }] }] };
  if (Object.keys(generationConfig).length) body.generationConfig = generationConfig;
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) throw new Error(await providerError(res, "google"));
  const j = (await res.json()) as {
    candidates?: { content?: { parts?: { inlineData?: { data?: string }; inline_data?: { data?: string } }[] } }[];
    promptFeedback?: { blockReason?: string };
  };
  if (j.promptFeedback?.blockReason) throw new Error(`Gemini blocked the prompt: ${j.promptFeedback.blockReason}`);
  const parts = j.candidates?.[0]?.content?.parts ?? [];
  const b64 = parts.map((p) => p.inlineData?.data ?? p.inline_data?.data).find(Boolean);
  if (!b64) throw new Error("Gemini returned no image — it may have replied with text only; try a more explicit image prompt");
  return Buffer.from(b64, "base64");
}

// ─── Voice (OpenAI /audio/speech or ElevenLabs — both return mp3 bytes) ───
export async function generateVoice(opts: {
  text: string;
  provider?: string;
  model?: string;
  voice?: string;
}): Promise<StudioItem> {
  const provider = opts.provider || "openai";
  const item = newItem("voice", opts.text, provider, opts.model || (provider === "elevenlabs" ? "eleven_multilingual_v2" : "gpt-4o-mini-tts"));
  const start = Date.now();
  item.meta.voice = opts.voice;
  live.set(item.id, item);
  try {
    const key = await getServiceKey(provider);
    if (!key) throw new Error(`No ${provider} key — add one in Settings → API Keys.`);
    let res: Response;
    if (provider === "elevenlabs") {
      const voiceId = opts.voice || "21m00Tcm4TlvDq8ikWAM"; // "Rachel" — a default public voice
      res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "audio/mpeg", "xi-api-key": key },
        body: JSON.stringify({ text: opts.text, model_id: item.model }),
      });
    } else {
      res = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: item.model, input: opts.text, voice: opts.voice || "alloy", response_format: "mp3" }),
      });
    }
    if (!res.ok) throw new Error(await providerError(res, provider));
    await writeMedia(item, Buffer.from(await res.arrayBuffer()));
    item.status = "done";
  } catch (e) {
    item.status = "error";
    item.error = (e as Error).message;
  }
  return finish(item, start, item.status === "done");
}

// ─── Video (Replicate predictions — create now, poll on list()) ───
export async function startVideo(opts: {
  prompt: string;
  provider?: string;
  model?: string;
}): Promise<StudioItem> {
  const provider = opts.provider || "replicate";
  const model = opts.model || "minimax/video-01";
  const item = newItem("video", opts.prompt, provider, model);
  live.set(item.id, item);
  try {
    const key = await getServiceKey(provider);
    if (!key) throw new Error(`No ${provider} key — add one in Settings → API Keys.`);
    // Official-model endpoint avoids needing a pinned version hash.
    const res = await fetch(`https://api.replicate.com/v1/models/${model}/predictions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ input: { prompt: opts.prompt } }),
    });
    if (!res.ok) throw new Error(await providerError(res, provider));
    const j = (await res.json()) as { id?: string; status?: string };
    if (!j.id) throw new Error("provider did not return a prediction id");
    item.meta.predictionId = j.id;
    item.status = "generating";
  } catch (e) {
    item.status = "error";
    item.error = (e as Error).message;
  }
  await saveItem(item);
  if (item.status === "error") live.delete(item.id);
  return item;
}

/** Advance any in-flight Replicate video predictions. Called on every list(). */
async function syncVideos(items: StudioItem[]): Promise<void> {
  const pending = items.filter((x) => x.kind === "video" && x.status === "generating" && x.meta.predictionId);
  if (pending.length === 0) return;
  const key = await getServiceKey("replicate");
  if (!key) return;
  await Promise.all(
    pending.map(async (item) => {
      try {
        const res = await fetch(`https://api.replicate.com/v1/predictions/${item.meta.predictionId}`, {
          headers: { Authorization: `Bearer ${key}` },
        });
        if (!res.ok) return;
        const j = (await res.json()) as { status?: string; output?: string | string[]; error?: string };
        if (j.status === "succeeded") {
          const url = Array.isArray(j.output) ? j.output[j.output.length - 1] : j.output;
          if (!url) throw new Error("prediction succeeded but returned no output URL");
          const media = await fetch(url);
          if (!media.ok) throw new Error(`could not download output (${media.status})`);
          await writeMedia(item, Buffer.from(await media.arrayBuffer()));
          item.status = "done";
          item.costUsd = COST["studio:video"];
          await saveItem(item);
          await recordUsage({ ts: Date.now(), agent: "studio:video", kind: "system", ms: 0, costUsd: COST["studio:video"], ok: true });
        } else if (j.status === "failed" || j.status === "canceled") {
          item.status = "error";
          item.error = j.error || j.status || "prediction failed";
          await saveItem(item);
        }
      } catch (e) {
        item.status = "error";
        item.error = (e as Error).message;
        await saveItem(item);
      }
    }),
  );
}

export async function listStudio(): Promise<StudioItem[]> {
  const disk = await readIndex();
  await syncVideos(disk);
  const merged = (await readIndex()).map((x) => {
    const mine = live.get(x.id);
    if (mine) return mine;
    if (x.status === "generating" && x.kind !== "video" && Date.now() - x.createdAt > STALE_MS) {
      x.status = "error";
      x.error = "stalled";
    }
    return x;
  });
  for (const x of live.values()) if (!merged.some((m) => m.id === x.id)) merged.unshift(x);
  return merged.sort((a, b) => b.createdAt - a.createdAt);
}

export async function readStudioMedia(id: string): Promise<{ bytes: Buffer; mime: string } | null> {
  const item = (await readIndex()).find((x) => x.id === id);
  if (!item || item.status !== "done" || !item.file) return null;
  const abs = path.normalize(path.join(kindDir(item.kind), item.file));
  if (!abs.startsWith(path.normalize(kindDir(item.kind) + path.sep))) return null;
  try {
    return { bytes: await fs.readFile(abs), mime: item.mime };
  } catch {
    return null;
  }
}

export async function deleteStudioItem(id: string): Promise<void> {
  const disk = await readIndex();
  const item = disk.find((x) => x.id === id);
  if (item?.file) {
    try {
      await fs.unlink(path.join(kindDir(item.kind), item.file));
    } catch {
      /* already gone */
    }
  }
  await fs.writeFile(indexFile(), JSON.stringify(disk.filter((x) => x.id !== id), null, 2), "utf8");
  live.delete(id);
}

export async function studioAvailable(): Promise<boolean> {
  return vaultAvailable();
}

/** Best-effort human-readable error from a provider's non-2xx response. */
async function providerError(res: Response, provider: string): Promise<string> {
  let detail = "";
  try {
    const text = await res.text();
    try {
      const j = JSON.parse(text) as { error?: { message?: string } | string; detail?: string; message?: string };
      detail =
        (typeof j.error === "object" ? j.error?.message : j.error) || j.detail || j.message || text.slice(0, 200);
    } catch {
      detail = text.slice(0, 200);
    }
  } catch {
    /* no body */
  }
  return `${provider} error ${res.status}${detail ? `: ${detail}` : ""}`;
}
