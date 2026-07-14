import fs from "fs/promises";
import path from "path";
import { runAgentText } from "./runners";
import { vaultInfo, vaultAvailable, todayStamp } from "./vault";
import { generateImage } from "./studio";
import { hasServiceKey } from "./services";
import { publishToWordPress } from "./publish";

/**
 * SEO Content pipeline — brief → fleet drafts an optimized article → scored
 * against a local SEO checklist → saved to the vault (Agentic OS/Content/) →
 * exported or published to WordPress. Reuses the Studio image engine for hero
 * images and lib/publish.ts for the WordPress push.
 */
export interface SeoCheck {
  label: string;
  pass: boolean;
  detail: string;
}

export interface ContentItem {
  id: string;
  keyword: string;
  title: string;
  slug: string;
  metaDescription: string;
  secondaryKeywords: string[];
  bodyMarkdown: string;
  heroPrompt: string;
  heroImageId?: string; // Studio item id
  file: string; // markdown filename inside Content/
  wordCount: number;
  seoScore: number;
  checks: SeoCheck[];
  status: "drafting" | "draft" | "error" | "published";
  publishedUrl?: string;
  error?: string;
  agent: string;
  createdAt: number;
}

const MAX_ITEMS = 200;
const STALE_MS = 10 * 60_000;
const live = new Map<string, ContentItem>();
let seq = 0;

function contentDir(): string {
  return path.join(vaultInfo().base, "Content");
}
function indexFile(): string {
  return path.join(contentDir(), "content.json");
}
function slugify(text: string): string {
  return (
    text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "post"
  );
}

async function readIndex(): Promise<ContentItem[]> {
  try {
    return JSON.parse(await fs.readFile(indexFile(), "utf8")) as ContentItem[];
  } catch {
    return [];
  }
}

async function saveItem(item: ContentItem): Promise<void> {
  const disk = await readIndex();
  const i = disk.findIndex((x) => x.id === item.id);
  if (i >= 0) disk[i] = item;
  else disk.unshift(item);
  await fs.mkdir(contentDir(), { recursive: true });
  await fs.writeFile(indexFile(), JSON.stringify(disk.slice(0, MAX_ITEMS), null, 2), "utf8");
}

function extractJson<T>(text: string): T | null {
  const m = text.replace(/```(?:json)?/gi, "").match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as T;
  } catch {
    return null;
  }
}

// ─── SEO scoring (fully local — no API) ───
export function scoreSeo(a: {
  keyword: string;
  title: string;
  slug: string;
  metaDescription: string;
  secondaryKeywords: string[];
  bodyMarkdown: string;
}): { score: number; checks: SeoCheck[]; wordCount: number } {
  const kw = a.keyword.trim().toLowerCase();
  const body = a.bodyMarkdown;
  const words = body.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const firstChunk = words.slice(0, 120).join(" ").toLowerCase();
  const h2 = (body.match(/^##\s+/gm) || []).length;
  const has = (s: string) => s.toLowerCase().includes(kw);

  const checks: SeoCheck[] = [
    { label: "Keyword in title", pass: has(a.title), detail: kw ? `“${a.keyword}”` : "no keyword" },
    { label: "Title length 30–60", pass: a.title.length >= 30 && a.title.length <= 60, detail: `${a.title.length} chars` },
    { label: "Meta description 120–160", pass: a.metaDescription.length >= 120 && a.metaDescription.length <= 160, detail: `${a.metaDescription.length} chars` },
    { label: "Keyword in meta", pass: has(a.metaDescription), detail: has(a.metaDescription) ? "present" : "missing" },
    { label: "Keyword in intro", pass: firstChunk.includes(kw), detail: "first ~120 words" },
    { label: "≥2 H2 sections", pass: h2 >= 2, detail: `${h2} found` },
    { label: "≥600 words", pass: wordCount >= 600, detail: `${wordCount} words` },
    { label: "Slug is clean + keyworded", pass: /^[a-z0-9]+(-[a-z0-9]+)*$/.test(a.slug) && a.slug.includes(kw.split(/\s+/)[0] || ""), detail: a.slug },
    { label: "≥3 secondary keywords", pass: a.secondaryKeywords.length >= 3, detail: `${a.secondaryKeywords.length} given` },
  ];
  const score = Math.round((checks.filter((c) => c.pass).length / checks.length) * 100);
  return { score, checks, wordCount };
}

function draftPrompt(keyword: string): string {
  return [
    `You are an expert SEO content writer. Write a complete, genuinely useful blog article optimized to rank for the target keyword.`,
    ``,
    `TARGET KEYWORD: ${keyword}`,
    ``,
    `Requirements:`,
    `- Natural, authoritative, non-fluffy writing a human would actually want to read. No keyword stuffing.`,
    `- 700–1100 words of Markdown body with a clear structure: a short intro that uses the keyword in the first sentence or two, then at least 3 "## " H2 sections (use "### " sub-points where useful), and a brief conclusion.`,
    `- SEO title ≤ 60 characters that contains the keyword.`,
    `- Meta description between 120 and 160 characters, compelling, containing the keyword.`,
    `- A URL slug: lowercase, hyphenated, containing the keyword.`,
    `- 3–6 secondary/LSI keywords.`,
    `- A vivid one-sentence prompt for a hero image that fits the article.`,
    ``,
    `Return ONLY valid JSON (no markdown fences, no commentary) with exactly these keys:`,
    `{"title": "...", "slug": "...", "metaDescription": "...", "secondaryKeywords": ["..."], "bodyMarkdown": "## ...", "heroPrompt": "..."}`,
  ].join("\n");
}

export async function startDraft(keyword: string, agent = "claude"): Promise<ContentItem> {
  const item: ContentItem = {
    id: `art-${Date.now().toString(36)}-${seq++}`,
    keyword: keyword.slice(0, 120),
    title: "",
    slug: "",
    metaDescription: "",
    secondaryKeywords: [],
    bodyMarkdown: "",
    heroPrompt: "",
    file: "",
    wordCount: 0,
    seoScore: 0,
    checks: [],
    status: "drafting",
    agent,
    createdAt: Date.now(),
  };
  live.set(item.id, item);
  await saveItem(item);

  void (async () => {
    try {
      const r = await runAgentText(agent, draftPrompt(item.keyword), { injectMemory: false });
      if (r.error) throw new Error(r.error);
      const j = extractJson<{
        title?: string;
        slug?: string;
        metaDescription?: string;
        secondaryKeywords?: string[];
        bodyMarkdown?: string;
        heroPrompt?: string;
      }>(r.text);
      if (!j || !j.bodyMarkdown || !j.title) throw new Error("draft did not return a usable article (missing title/body)");

      item.title = String(j.title).trim().slice(0, 160);
      item.slug = slugify(j.slug || j.title);
      item.metaDescription = String(j.metaDescription ?? "").trim().slice(0, 320);
      item.secondaryKeywords = Array.isArray(j.secondaryKeywords) ? j.secondaryKeywords.map((s) => String(s).trim()).filter(Boolean).slice(0, 12) : [];
      item.bodyMarkdown = String(j.bodyMarkdown);
      item.heroPrompt = String(j.heroPrompt ?? "").trim().slice(0, 400);

      const scored = scoreSeo(item);
      item.seoScore = scored.score;
      item.checks = scored.checks;
      item.wordCount = scored.wordCount;

      item.file = `${item.slug}-${item.id.slice(-4)}.md`;
      item.status = "draft"; // set before writing so the note's frontmatter is accurate
      await fs.mkdir(contentDir(), { recursive: true });
      await fs.writeFile(path.join(contentDir(), item.file), articleMarkdown(item), "utf8");
    } catch (e) {
      item.status = "error";
      item.error = (e as Error).message;
    }
    await saveItem(item);
    live.delete(item.id);
  })();

  return item;
}

/** The vault note: YAML frontmatter + the article body. */
function articleMarkdown(item: ContentItem): string {
  const fm = [
    "---",
    `title: ${JSON.stringify(item.title)}`,
    `description: ${JSON.stringify(item.metaDescription)}`,
    `keyword: ${JSON.stringify(item.keyword)}`,
    `slug: ${item.slug}`,
    `secondaryKeywords: [${item.secondaryKeywords.map((k) => JSON.stringify(k)).join(", ")}]`,
    `seoScore: ${item.seoScore}`,
    `date: ${todayStamp()}`,
    `status: ${item.status}`,
    "---",
    "",
  ].join("\n");
  return fm + `# ${item.title}\n\n` + item.bodyMarkdown + "\n";
}

// ─── Minimal Markdown → HTML for export / WordPress ───
export function mdToHtml(md: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s: string) =>
    esc(s)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, t: string, u: string) =>
        /^(https?:|\/|#)/i.test(u) ? `<a href="${u}">${t}</a>` : t,
      );

  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${inline(para.join(" "))}</p>`);
      para = [];
    }
  };
  const closeList = () => {
    if (list) {
      out.push(`</${list}>`);
      list = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    let m: RegExpMatchArray | null;
    if (!line.trim()) {
      flushPara();
      closeList();
    } else if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      flushPara();
      closeList();
      const level = Math.min(m[1].length, 6);
      out.push(`<h${level}>${inline(m[2])}</h${level}>`);
    } else if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      flushPara();
      closeList();
      out.push("<hr>");
    } else if ((m = line.match(/^\s*[-*+]\s+(.*)$/))) {
      flushPara();
      if (list !== "ul") {
        closeList();
        out.push("<ul>");
        list = "ul";
      }
      out.push(`<li>${inline(m[1])}</li>`);
    } else if ((m = line.match(/^\s*\d+\.\s+(.*)$/))) {
      flushPara();
      if (list !== "ol") {
        closeList();
        out.push("<ol>");
        list = "ol";
      }
      out.push(`<li>${inline(m[1])}</li>`);
    } else if ((m = line.match(/^>\s?(.*)$/))) {
      flushPara();
      closeList();
      out.push(`<blockquote><p>${inline(m[1])}</p></blockquote>`);
    } else {
      para.push(line);
    }
  }
  flushPara();
  closeList();
  return out.join("\n");
}

export async function listContent(): Promise<ContentItem[]> {
  const disk = await readIndex();
  const merged = disk.map((x) => {
    const mine = live.get(x.id);
    if (mine) return mine;
    if (x.status === "drafting" && Date.now() - x.createdAt > STALE_MS) {
      x.status = "error";
      x.error = "stalled";
    }
    return x;
  });
  for (const x of live.values()) if (!merged.some((m) => m.id === x.id)) merged.unshift(x);
  return merged.sort((a, b) => b.createdAt - a.createdAt);
}

export async function findContent(id: string): Promise<ContentItem | undefined> {
  return live.get(id) ?? (await readIndex()).find((x) => x.id === id);
}

export async function deleteContent(id: string): Promise<void> {
  const disk = await readIndex();
  const item = disk.find((x) => x.id === id);
  if (item?.file) {
    try {
      await fs.unlink(path.join(contentDir(), item.file));
    } catch {
      /* already gone */
    }
  }
  await fs.writeFile(indexFile(), JSON.stringify(disk.filter((x) => x.id !== id), null, 2), "utf8");
  live.delete(id);
}

/** Generate a hero image via the Studio engine (whichever image provider is keyed). */
export async function generateHero(id: string): Promise<ContentItem> {
  const item = await findContent(id);
  if (!item) throw new Error("article not found");
  const provider = (await hasServiceKey("openai")) ? "openai" : (await hasServiceKey("google")) ? "google" : null;
  if (!provider) throw new Error("No image provider — add an OpenAI or Gemini key in Settings → API Keys.");
  const prompt = item.heroPrompt || `A hero image for an article titled "${item.title}"`;
  const img = await generateImage({ prompt, provider });
  if (img.status !== "done") throw new Error(img.error || "hero image generation failed");
  item.heroImageId = img.id;
  await saveItem(item);
  return item;
}

/** Push an article to WordPress (as a draft by default). */
export async function publishContent(id: string, status: "draft" | "publish" = "draft"): Promise<ContentItem> {
  const item = await findContent(id);
  if (!item) throw new Error("article not found");
  if (item.status === "drafting") throw new Error("article is still drafting");
  const html = mdToHtml(item.bodyMarkdown);
  const result = await publishToWordPress({
    title: item.title,
    content: html,
    excerpt: item.metaDescription,
    slug: item.slug,
    status,
  });
  item.status = "published";
  item.publishedUrl = result.url;
  await saveItem(item);
  return item;
}

export async function contentAvailable(): Promise<boolean> {
  return vaultAvailable();
}
