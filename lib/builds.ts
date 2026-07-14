import fs from "fs/promises";
import path from "path";
import { runAgentText } from "./runners";
import { vaultInfo, vaultAvailable } from "./vault";

/**
 * The Builds shelf: commission an agent to produce a complete SINGLE-FILE
 * HTML game or app (no external resources), stored in the vault under
 * "Agentic OS/Builds/" so the shelf syncs across machines like the rest of
 * the brain. The index lives beside the files for the same reason.
 */
export interface Build {
  id: string;
  title: string;
  prompt: string;
  kind: "game" | "app";
  file: string; // filename inside Builds/
  status: "building" | "done" | "error";
  error?: string;
  agent: string;
  size: number;
  createdAt: number;
}

const MAX_BUILDS = 100;
const STALE_MS = 10 * 60_000;
const live = new Map<string, Build>();

function buildsDir(): string {
  return path.join(vaultInfo().base, "Builds");
}
function indexFile(): string {
  return path.join(buildsDir(), "builds.json");
}

async function readIndex(): Promise<Build[]> {
  try {
    return JSON.parse(await fs.readFile(indexFile(), "utf8")) as Build[];
  } catch {
    return [];
  }
}

async function saveBuild(build: Build): Promise<void> {
  const disk = await readIndex();
  const i = disk.findIndex((b) => b.id === build.id);
  if (i >= 0) disk[i] = build;
  else disk.unshift(build);
  await fs.mkdir(buildsDir(), { recursive: true });
  await fs.writeFile(indexFile(), JSON.stringify(disk.slice(0, MAX_BUILDS), null, 2), "utf8");
}

export async function listBuilds(): Promise<Build[]> {
  const disk = await readIndex();
  const merged = disk.map((b) => {
    const mine = live.get(b.id);
    if (mine) return mine;
    if (b.status === "building" && Date.now() - b.createdAt > STALE_MS) {
      b.status = "error";
      b.error = "stalled";
    }
    return b;
  });
  for (const b of live.values()) if (!merged.some((x) => x.id === b.id)) merged.unshift(b);
  return merged;
}

export async function readBuildHtml(id: string): Promise<string | null> {
  const build = (await readIndex()).find((b) => b.id === id);
  if (!build || build.status !== "done") return null;
  const abs = path.normalize(path.join(buildsDir(), build.file));
  if (!abs.startsWith(path.normalize(buildsDir() + path.sep))) return null;
  try {
    return await fs.readFile(abs, "utf8");
  } catch {
    return null;
  }
}

export async function deleteBuild(id: string): Promise<void> {
  const disk = await readIndex();
  const build = disk.find((b) => b.id === id);
  if (build) {
    try {
      await fs.unlink(path.join(buildsDir(), build.file));
    } catch {
      /* already gone */
    }
  }
  await fs.writeFile(indexFile(), JSON.stringify(disk.filter((b) => b.id !== id), null, 2), "utf8");
  live.delete(id);
}

function slugify(text: string): string {
  return (
    text.slice(0, 50).replace(/[^a-z0-9 ]/gi, "").trim().replace(/\s+/g, "-").toLowerCase() || "build"
  );
}

function extractHtml(text: string): string | null {
  const fenced = text.match(/```html?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  const start = raw.search(/<!doctype html|<html/i);
  if (start === -1) return null;
  const end = raw.lastIndexOf("</html>");
  return end === -1 ? raw.slice(start) : raw.slice(start, end + "</html>".length);
}

function builderPrompt(prompt: string, kind: "game" | "app"): string {
  return [
    `You are the ${kind === "game" ? "Coding Video Game Agent" : "App Builder Agent"}. Build EXACTLY what is asked as ONE complete, self-contained, single-file HTML document.`,
    ``,
    `THE COMMISSION: ${prompt}`,
    ``,
    `Hard rules:`,
    `- Single .html file. ALL CSS and JS inline. NO external resources — no CDNs, fonts, images, fetch calls, or libraries.`,
    kind === "game"
      ? `- Playable immediately: canvas-based rendering, keyboard (arrows/WASD) + touch controls, a start screen with a one-line "how to play", score display, and a game-over/restart flow. Smooth 60fps game loop via requestAnimationFrame.`
      : `- Fully functional immediately: real interactivity, sensible defaults, localStorage persistence where it fits.`,
    `- Polished dark-neon aesthetic (deep background, glowing accents), responsive to any window size.`,
    `- No console errors. Test the logic mentally before finalizing.`,
    ``,
    `Output ONLY the HTML document, starting with <!DOCTYPE html>. No commentary, no markdown fences.`,
  ].join("\n");
}

let seq = 0;

export async function startBuild(prompt: string, kind: "game" | "app", agent = "claude"): Promise<Build> {
  const build: Build = {
    id: `bld-${Date.now().toString(36)}-${seq++}`,
    title: prompt.slice(0, 70),
    prompt: prompt.slice(0, 2000),
    kind,
    file: "",
    status: "building",
    agent,
    size: 0,
    createdAt: Date.now(),
  };
  live.set(build.id, build);
  await saveBuild(build);

  void (async () => {
    try {
      const r = await runAgentText(agent, builderPrompt(build.prompt, kind), { injectMemory: false });
      if (r.error) throw new Error(r.error);
      const html = extractHtml(r.text);
      if (!html) throw new Error("agent did not return an HTML document");
      const file = `${slugify(build.prompt)}-${build.id.slice(-4)}.html`;
      await fs.mkdir(buildsDir(), { recursive: true });
      await fs.writeFile(path.join(buildsDir(), file), html, "utf8");
      build.file = file;
      build.size = Buffer.byteLength(html, "utf8");
      // let the model title its own creation via the <title> tag
      const t = html.match(/<title>([^<]{3,60})<\/title>/i);
      if (t) build.title = t[1].trim();
      build.status = "done";
    } catch (e) {
      build.status = "error";
      build.error = (e as Error).message;
    }
    await saveBuild(build);
    live.delete(build.id);
  })();

  return build;
}

export async function buildsAvailable(): Promise<boolean> {
  return vaultAvailable();
}
