import fs from "fs/promises";
import path from "path";
import { runAgentText } from "./runners";
import { vaultInfo, vaultAvailable, todayStamp } from "./vault";

/**
 * Keyless YouTube trend watcher. Reads each watched channel's public RSS feed
 * (https://www.youtube.com/feeds/videos.xml?channel_id=…) — no API key — scores
 * recent videos by recency + keyword match + views, clusters them into "signal"
 * cards, and has a cheap agent draft titles/angles. Rescans on the scheduler
 * tick (throttled to every 4h) and logs each sweep to the vault.
 */
export interface WatchChannel {
  id: string; // UC… channel id
  name: string;
}

export interface WatchConfig {
  channels: WatchChannel[];
  keywords: string[];
  lastScan?: number;
}

export interface Signal {
  rank: number;
  videoId: string;
  title: string;
  channel: string;
  views?: number;
  published: number;
  category: string;
  magnitude: number; // 0..100
  url: string;
  titles?: string[]; // AI-drafted "ready to fire" titles
  angles?: string[];
}

export interface Sweep {
  ts: number;
  day: string;
  signals: Signal[];
}

const CONFIG_FILE = path.join(process.cwd(), "data", "watcher.json");
const SWEEPS_FILE = path.join(process.cwd(), "data", "watcher-sweeps.json");
const RESCAN_MS = 4 * 60 * 60_000;
const MAX_SWEEPS = 30;
const RECENT_DAYS = 7;

const CATEGORY_HINTS: Record<string, string[]> = {
  MODELS: ["gpt", "claude", "gemini", "llama", "model", "fable", "opus", "sonnet", "grok", "qwen", "mistral"],
  AGENTS: ["agent", "mcp", "autonomous", "orchestrat", "swarm", "crew"],
  TOOLS: ["tool", "cli", "ide", "cursor", "code", "workflow", "n8n"],
  SEO: ["seo", "rank", "keyword", "traffic", "backlink"],
  MONEY: ["money", "revenue", "business", "monetiz", "profit", "$"],
};

let scanning = false;

export async function readConfig(): Promise<WatchConfig> {
  try {
    return JSON.parse(await fs.readFile(CONFIG_FILE, "utf8")) as WatchConfig;
  } catch {
    return { channels: [], keywords: [] };
  }
}

export async function writeConfig(cfg: WatchConfig): Promise<void> {
  await fs.mkdir(path.dirname(CONFIG_FILE), { recursive: true });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2), "utf8");
}

export async function listSweeps(): Promise<Sweep[]> {
  try {
    return JSON.parse(await fs.readFile(SWEEPS_FILE, "utf8")) as Sweep[];
  } catch {
    return [];
  }
}

async function saveSweep(sweep: Sweep): Promise<void> {
  const all = await listSweeps();
  all.unshift(sweep);
  await fs.mkdir(path.dirname(SWEEPS_FILE), { recursive: true });
  await fs.writeFile(SWEEPS_FILE, JSON.stringify(all.slice(0, MAX_SWEEPS), null, 2), "utf8");
}

function categorize(title: string): string {
  const t = title.toLowerCase();
  for (const [cat, words] of Object.entries(CATEGORY_HINTS)) {
    if (words.some((w) => t.includes(w))) return cat;
  }
  return "AGENTS";
}

interface RawVideo {
  videoId: string;
  title: string;
  channel: string;
  published: number;
  views?: number;
}

function parseFeed(xml: string): RawVideo[] {
  const channel = xml.match(/<title>([^<]*)<\/title>/)?.[1] ?? "channel";
  const out: RawVideo[] = [];
  for (const entry of xml.split("<entry>").slice(1)) {
    const videoId = entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1];
    const title = entry.match(/<title>([^<]*)<\/title>/)?.[1];
    const published = entry.match(/<published>([^<]+)<\/published>/)?.[1];
    const views = entry.match(/<media:statistics views="(\d+)"/)?.[1];
    if (videoId && title && published) {
      out.push({
        videoId,
        title: title.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"'),
        channel,
        published: Date.parse(published),
        views: views ? Number(views) : undefined,
      });
    }
  }
  return out;
}

async function fetchChannel(id: string): Promise<RawVideo[]> {
  try {
    const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(id)}`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];
    return parseFeed(await res.text());
  } catch {
    return [];
  }
}

/** Draft 5 titles + 3 angles for the top signals via a cheap agent. */
async function enrichSignals(signals: Signal[]): Promise<void> {
  await Promise.all(
    signals.slice(0, 6).map(async (s) => {
      const prompt = [
        `A trending YouTube video in the AI space: "${s.title}" (${s.channel}${s.views ? `, ${s.views} views` : ""}).`,
        `You make AI content. Return ONLY JSON: {"titles": ["5 punchy YouTube titles riffing on this trend, each under 60 chars"], "angles": ["3 distinct content angles — contrarian, build-along, comparison, etc."]}`,
      ].join("\n");
      const r = await runAgentText("auto", prompt, { injectMemory: false });
      if (r.error) return;
      const m = r.text.replace(/```(?:json)?/gi, "").match(/\{[\s\S]*\}/);
      if (!m) return;
      try {
        const parsed = JSON.parse(m[0]) as { titles?: string[]; angles?: string[] };
        s.titles = (parsed.titles ?? []).slice(0, 5);
        s.angles = (parsed.angles ?? []).slice(0, 3);
      } catch {
        /* leave un-enriched */
      }
    })
  );
}

export async function runScan(opts: { enrich?: boolean } = {}): Promise<Sweep | null> {
  if (scanning) return null;
  scanning = true;
  try {
    const cfg = await readConfig();
    if (cfg.channels.length === 0) return null;

    const cutoff = Date.now() - RECENT_DAYS * 86_400_000;
    const videos = (await Promise.all(cfg.channels.map((c) => fetchChannel(c.id)))).flat().filter((v) => v.published > cutoff);

    const kw = cfg.keywords.map((k) => k.toLowerCase()).filter(Boolean);
    const maxViews = Math.max(1, ...videos.map((v) => v.views ?? 0));
    const scored = videos.map((v) => {
      const ageDays = (Date.now() - v.published) / 86_400_000;
      const recency = Math.max(0, 1 - ageDays / RECENT_DAYS); // 1 fresh → 0 at cutoff
      const kwHit = kw.length ? (kw.some((k) => v.title.toLowerCase().includes(k)) ? 1 : 0) : 0.5;
      const viewScore = v.views ? Math.min(1, v.views / maxViews) : 0.3;
      const magnitude = Math.round((recency * 0.5 + kwHit * 0.3 + viewScore * 0.2) * 100);
      return { v, magnitude };
    });
    scored.sort((a, b) => b.magnitude - a.magnitude);

    const signals: Signal[] = scored.slice(0, 12).map(({ v, magnitude }, i) => ({
      rank: i + 1,
      videoId: v.videoId,
      title: v.title,
      channel: v.channel,
      views: v.views,
      published: v.published,
      category: categorize(v.title),
      magnitude,
      url: `https://www.youtube.com/watch?v=${v.videoId}`,
    }));

    if (opts.enrich !== false) await enrichSignals(signals);

    const sweep: Sweep = { ts: Date.now(), day: todayStamp(), signals };
    await saveSweep(sweep);
    cfg.lastScan = Date.now();
    await writeConfig(cfg);
    await logToVault(sweep).catch(() => {});
    return sweep;
  } finally {
    scanning = false;
  }
}

async function logToVault(sweep: Sweep): Promise<void> {
  if (!(await vaultAvailable())) return;
  const dir = path.join(vaultInfo().base, "YouTube Watcher");
  await fs.mkdir(dir, { recursive: true });
  const md = [
    `# YouTube Watcher — ${sweep.day}`,
    ``,
    `#agentic-os/watcher · [[Agentic OS/Home|Agentic OS]] · swept ${new Date(sweep.ts).toISOString()}`,
    ``,
    ...sweep.signals.flatMap((s) => [
      `## ${s.rank}. ${s.title}  (${s.magnitude})`,
      `${s.channel}${s.views ? ` · ${s.views} views` : ""} · [${s.category}] · ${s.url}`,
      ...(s.titles?.length ? [``, `**Titles:** ${s.titles.join(" · ")}`] : []),
      ...(s.angles?.length ? [`**Angles:** ${s.angles.join(" · ")}`] : []),
      ``,
    ]),
  ].join("\n");
  await fs.writeFile(path.join(dir, `${sweep.day}.md`), md, "utf8");
}

/** Called from the scheduler tick; throttled to every 4h. */
export async function maybeRescan(): Promise<void> {
  const cfg = await readConfig();
  if (cfg.channels.length === 0) return;
  if (cfg.lastScan && Date.now() - cfg.lastScan < RESCAN_MS) return;
  await runScan().catch(() => {});
}
