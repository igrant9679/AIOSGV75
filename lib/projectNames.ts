import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";

/**
 * Descriptive names for sessions and projects.
 *
 * A session's folder is often useless as a project name — the desktop app
 * opens in the home folder or a throwaway scratch folder, Codex Desktop makes
 * a dated folder per chat. So the project is resolved from the best evidence
 * available, in order:
 *
 *   user     — you renamed it on the Projects page (data/session-names.json)
 *   folder   — the session was started inside a real project folder
 *   files    — the folder holding most of the files the session read/edited
 *   job      — one of Mission Control's own scheduled jobs
 *   ai       — "Group with AI" sorted it (data/session-names.json)
 *   unsorted — nothing to go on yet
 *
 * Titles prefer human names (your renames, desktop-app renames, /rename),
 * then Mission Control job names, Codex thread names, AI names, the
 * auto-title, and finally the first prompt.
 */

export type ProjectSource = "user" | "folder" | "files" | "job" | "ai" | "unsorted";
export type TitleSource = "user" | "app" | "job" | "codex" | "ai" | "auto" | "prompt";

export const UNSORTED = "Unsorted";
export const JOBS_PROJECT = "Mission Control jobs";

// ─── folder classification ───

/** Folders that hold projects but are never a project themselves. */
const CONTAINER_NAMES = new Set([
  "users", "home", "documents", "desktop", "downloads", "pictures", "videos", "music",
  "source", "repos", "code", "projects", "dev", "github", "git", "workspace", "workspaces",
  "sites", "work", "onedrive", "dropbox", "google drive", "icloud drive",
  "outputs", "output", "exports", "screenshots",
]);

/** Sub-folders that are part of a project, not the project. */
const GENERIC_SUB = new Set([
  "src", "lib", "app", "components", "docs", "doc", "scripts", "data", "assets", "public",
  "test", "tests", "__tests__", "out", "dist", "build", "styles", "pages", "utils", "config",
  "bin", ".vscode", "images", "img", "static", "server", "client", "api", "hooks", "notes",
]);

/** Files that mark a folder as a project root. */
const MARKERS = [".git", "package.json", "pyproject.toml", "CLAUDE.md", "AGENTS.md", "Cargo.toml", "go.mod", "requirements.txt", ".obsidian"];

function norm(p: string): string {
  // Git-Bash style /c/Users/x → C:\Users\x
  const msys = p.match(/^[\\/]([a-zA-Z])([\\/].*)?$/);
  const s = msys ? `${msys[1].toUpperCase()}:${msys[2] ?? ""}` : p;
  return s.replace(/\//g, "\\").replace(/\\+$/, "");
}

function base(p: string): string {
  const parts = norm(p).split("\\");
  return parts[parts.length - 1] ?? "";
}

function parent(p: string): string | null {
  const n = norm(p);
  const i = n.lastIndexOf("\\");
  return i > 0 ? n.slice(0, i) : null;
}

/** Paths that say nothing about which project you were in. */
function isIgnored(p: string): boolean {
  return /\\(AppData|\.claude|\.codex|\.cache|\.npm|Temp|tmp|node_modules|\.git|Windows|Program Files[^\\]*|ProgramData)(\\|$)/i.test(norm(p)) ||
    isScratchDir(p);
}

/** Throwaway per-chat folders: desktop-app scratch, Codex Desktop's dated chat folders. */
export function isScratchDir(p: string): boolean {
  return /scratch-workspaces/i.test(p) || /\\Documents\\Codex\\\d{4}-\d{2}-\d{2}(\\|$)/i.test(norm(p)) || /\\\.codex\\visualizations/i.test(norm(p));
}

function isContainer(p: string): boolean {
  const n = norm(p);
  if (/^[A-Z]:$/i.test(n) || n === "") return true; // drive root
  if (/^[A-Z]:\\(Users|home)(\\[^\\]+)?$/i.test(n) || /^\/(Users|home)(\/[^/]+)?$/.test(p)) return true; // home folders
  const b = base(n).toLowerCase();
  return CONTAINER_NAMES.has(b) || /^onedrive\b/.test(b) || / - documents$/.test(b) || isCatchAllFolder(n);
}

const catchAllMemo = new Map<string, boolean>();
/**
 * A folder on this disk with no project marker and lots of sub-folders is a
 * place projects live ("AI Projects and Training"), not a project itself.
 */
function isCatchAllFolder(dir: string): boolean {
  const k = dir.toLowerCase();
  const hit = catchAllMemo.get(k);
  if (hit !== undefined) return hit;
  let result = false;
  try {
    if (!hasMarker(dir)) {
      const subdirs = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith(".")).length;
      result = subdirs >= 15;
    }
  } catch {
    /* not on this machine */
  }
  if (catchAllMemo.size > 5000) catchAllMemo.clear();
  catchAllMemo.set(k, result);
  return result;
}

const markerMemo = new Map<string, boolean>();
function hasMarker(dir: string): boolean {
  const hit = markerMemo.get(dir);
  if (hit !== undefined) return hit;
  let found = false;
  for (const m of MARKERS) {
    try {
      if (fs.existsSync(path.join(dir, m))) {
        found = true;
        break;
      }
    } catch {
      /* unreadable — treat as no marker */
    }
  }
  if (markerMemo.size > 5000) markerMemo.clear();
  markerMemo.set(dir, found);
  return found;
}

const rootMemo = new Map<string, string | null>();

/**
 * The project folder a path belongs to: the OUTERMOST ancestor with a project
 * marker (.git, package.json, CLAUDE.md…) — so a monorepo's apps/web counts
 * as the monorepo — else the folder sitting directly inside a container
 * (C:\Users\me\usip\server\x → usip). Undefined for paths in containers,
 * temp dirs, scratch folders and app data.
 */
export function projectRootOf(p: string, isDir = false): string | undefined {
  const n = norm(p);
  if (!n || isIgnored(n)) return undefined;
  const dir: string | null = isDir || !/\.[A-Za-z0-9]{1,6}$/.test(base(n)) ? n : parent(n);
  if (!dir || isContainer(dir)) return undefined;
  const key = dir.toLowerCase();
  const memo = rootMemo.get(key);
  if (memo !== undefined) return memo ?? undefined;

  let outermostMarker: string | undefined;
  let underContainer: string | undefined;
  for (let d: string | null = dir; d && !isContainer(d); d = parent(d)) {
    if (hasMarker(d)) outermostMarker = d;
    const up = parent(d);
    if (!up || isContainer(up)) underContainer = d;
  }
  const root = outermostMarker ?? underContainer;
  if (rootMemo.size > 5000) rootMemo.clear();
  rootMemo.set(key, root ?? null);
  return root;
}

/**
 * Folders a session touched, with counts (top 40). Stored in the parse cache
 * so the project rules above can change without re-reading every session.
 */
export function tallyDirs(paths: string[]): [string, number][] {
  const counts = new Map<string, [string, number]>();
  for (const p of paths) {
    const n = norm(p);
    if (!n || isIgnored(n)) continue;
    const dir = /\.[A-Za-z0-9]{1,6}$/.test(base(n)) ? parent(n) : n;
    if (!dir) continue;
    const k = dir.toLowerCase();
    const cur = counts.get(k);
    counts.set(k, [cur?.[0] ?? dir, (cur?.[1] ?? 0) + 1]);
  }
  return [...counts.values()].sort((a, b) => b[1] - a[1]).slice(0, 40);
}

/** Most-used project root among the folders a session touched (≥25% of touches). */
export function inferWorkDir(dirs: [string, number][] | undefined): string | undefined {
  const votes = new Map<string, [string, number]>();
  let total = 0;
  for (const [d, n] of dirs ?? []) {
    const root = projectRootOf(d, true);
    if (!root) continue;
    total += n;
    const k = root.toLowerCase();
    votes.set(k, [votes.get(k)?.[0] ?? root, (votes.get(k)?.[1] ?? 0) + n]);
  }
  if (!total) return undefined;
  const [root, n] = [...votes.values()].sort((a, b) => b[1] - a[1])[0];
  return n / total >= 0.25 ? root : undefined;
}

/** Absolute Windows / POSIX paths mentioned in a command or tool input. */
export function pathsIn(text: string): string[] {
  const out: string[] = [];
  const t = text.replace(/\\\\/g, "\\");
  // Upper-case drive letter, no second colon: skips regex text like \d\d:\d\d.
  for (const m of t.matchAll(/\b[A-Z]:\\[^"'`<>|*?:\r\n]+/g)) {
    const v = m[0].replace(/[\s.,;)\]}]+$/, "");
    if (/[A-Za-z]{2}/.test(v.slice(3)) && !/\\[dswbDSWB][\\+*?{]/.test(v)) out.push(v);
  }
  for (const m of t.matchAll(/(?:^|[\s"'=])(\/(?:Users|home)\/[^\s"'`<>|*?]+)/g)) out.push(m[1]);
  return out;
}

/** "mission-control" → "Mission Control"; names with spaces or capitals stay as typed. */
export function prettyProject(dir: string): string {
  const b = base(dir);
  if (/[A-Z ]/.test(b)) return b;
  return b
    .split(/[-_.]+/)
    .filter(Boolean)
    .map((w) => (w.length <= 3 && /^(ai|ui|os|api|sdk|cli|llm|mcp|seo|crm|daf|idm)$/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

/** The project a session's start folder names, if that folder is a real project. */
export function folderProject(cwd: string): string | undefined {
  if (!cwd || isScratchDir(cwd)) return undefined;
  return projectRootOf(cwd, true);
}

// ─── Claude desktop app titles ───

export interface AppTitle {
  title?: string;
  byUser: boolean;
  /** when you last had this session open in the desktop app */
  lastOpenedAt?: number;
}

const appMemo = new Map<string, { mtimeMs: number; cli?: string; title?: string; byUser: boolean; lastOpenedAt?: number }>();

function appSessionRoots(): string[] {
  const roots: string[] = [];
  const local = process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
  const roaming = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
  try {
    for (const acct of fs.readdirSync(path.join(local, "Claude-Data"))) roots.push(path.join(local, "Claude-Data", acct, "claude-code-sessions"));
  } catch {
    /* no desktop app here */
  }
  roots.push(path.join(roaming, "Claude", "claude-code-sessions"));
  return roots;
}

/**
 * Session titles the Claude desktop app shows in its sidebar, keyed by the
 * Claude Code session id, plus when you last opened each one. Only
 * `cliSessionId`, `title`, `titleSource` and `lastFocusedAt` are read.
 */
export async function desktopAppTitles(): Promise<Map<string, AppTitle>> {
  const out = new Map<string, AppTitle>();
  for (const root of appSessionRoots()) {
    let orgs: string[] = [];
    try {
      orgs = await fsp.readdir(root);
    } catch {
      continue;
    }
    for (const org of orgs) {
      let spaces: string[] = [];
      try {
        spaces = await fsp.readdir(path.join(root, org));
      } catch {
        continue;
      }
      for (const sp of spaces) {
        const dir = path.join(root, org, sp);
        let files: string[] = [];
        try {
          files = await fsp.readdir(dir);
        } catch {
          continue;
        }
        for (const f of files) {
          if (!f.startsWith("local_") || !f.endsWith(".json")) continue;
          const file = path.join(dir, f);
          try {
            const st = await fsp.stat(file);
            let m = appMemo.get(file);
            if (!m || m.mtimeMs !== st.mtimeMs) {
              const o = JSON.parse(await fsp.readFile(file, "utf8")) as { cliSessionId?: string; title?: string; titleSource?: string; lastFocusedAt?: number };
              m = { mtimeMs: st.mtimeMs, cli: o.cliSessionId, title: o.title?.trim(), byUser: o.titleSource === "user", lastOpenedAt: typeof o.lastFocusedAt === "number" ? o.lastFocusedAt : undefined };
              appMemo.set(file, m);
            }
            if (m.cli) out.set(m.cli, { title: m.title, byUser: m.byUser, lastOpenedAt: m.lastOpenedAt });
          } catch {
            /* partial write — next refresh */
          }
        }
      }
    }
  }
  return out;
}

// ─── Mission Control's own jobs ───

export interface JobDef {
  name: string;
  prompt: string;
}

const BUILTIN_JOBS: JobDef[] = [
  { name: "Profile upkeep", prompt: "You maintain the user profile for" },
  { name: "Profile upkeep", prompt: "This profile is " },
];

export async function readJobDefs(): Promise<JobDef[]> {
  const out = [...BUILTIN_JOBS];
  try {
    const raw = JSON.parse(await fsp.readFile(path.join(process.cwd(), "data", "schedules.json"), "utf8")) as unknown;
    const list = Array.isArray(raw) ? raw : ((raw as { schedules?: unknown[] }).schedules ?? []);
    for (const s of list as { title?: string; name?: string; prompt?: string }[]) {
      const name = s.title ?? s.name;
      if (name && s.prompt) out.push({ name, prompt: s.prompt });
    }
  } catch {
    /* no schedules */
  }
  return out;
}

function shortDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** "Chief of Staff · Nov 4" when the first prompt is one of Mission Control's jobs. */
export function jobTitle(firstPrompt: string | undefined, startedAt: number, jobs: JobDef[]): string | undefined {
  if (!firstPrompt) return undefined;
  const fp = firstPrompt.trim();
  for (const j of jobs) {
    const head = j.prompt.split("{{")[0].split("\n")[0].trim();
    const probe = head.slice(0, 60);
    if (probe.length >= 12 && fp.startsWith(probe)) {
      const name = j.name.replace(/^[^\p{L}\p{N}]+/u, "").trim();
      return `${name} · ${shortDate(startedAt)}`;
    }
  }
  return undefined;
}

/** Titles that are really a pasted prompt or injected context, not a name. */
export function looksLikeJunkTitle(t: string): boolean {
  const s = t.trim();
  return (
    !s ||
    s === "Untitled session" ||
    s.length > 70 ||
    /^[<[{#]/.test(s) ||
    /^(you are|you're|act as|previous conversation)/i.test(s) ||
    /…$/.test(s)
  );
}
