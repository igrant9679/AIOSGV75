import fsp from "fs/promises";
import path from "path";
import { runClaudeText } from "./runners";
import { UNSORTED, looksLikeJunkTitle } from "./projectNames";
import type { SessionSummary } from "./sessions";

/**
 * Name overrides for sessions — your renames and "Group with AI" results.
 * data/session-names.json is the source of truth; it is re-read on every
 * call (AGENTS.md rule 1). A user entry is never overwritten by the AI.
 */

export interface NameOverride {
  title?: string;
  project?: string;
  /** hidden from the Projects page */
  hidden?: boolean;
  by: "user" | "ai";
  at: number;
}

interface NamesFile {
  v: 1;
  sessions: Record<string, NameOverride>;
  lastAiRun?: { at: number; named: number; error?: string };
}

const NAMES_FILE = path.join(process.cwd(), "data", "session-names.json");

export async function readNames(): Promise<NamesFile> {
  try {
    const f = JSON.parse(await fsp.readFile(NAMES_FILE, "utf8")) as NamesFile;
    if (f && f.sessions) return f;
  } catch {
    /* first run */
  }
  return { v: 1, sessions: {} };
}

async function writeNames(mutate: (f: NamesFile) => void): Promise<void> {
  const f = await readNames(); // re-read right before writing so concurrent edits merge
  mutate(f);
  await fsp.mkdir(path.dirname(NAMES_FILE), { recursive: true });
  const tmp = `${NAMES_FILE}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(f, null, 2), "utf8");
  await fsp.rename(tmp, NAMES_FILE);
}

const clean = (s: unknown, max: number) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : undefined);

/**
 * Your rename. `title` / `project` of "" clears that part of the override
 * (back to the automatic name); undefined leaves it alone.
 */
export async function renameSessions(keys: string[], change: { title?: string; project?: string }): Promise<void> {
  await writeNames((f) => {
    for (const key of keys) {
      const cur = f.sessions[key] ?? { by: "user" as const, at: 0 };
      const next: NameOverride = { ...cur, by: "user", at: Date.now() };
      if (change.title !== undefined) next.title = clean(change.title, 120) || undefined;
      if (change.project !== undefined) next.project = clean(change.project, 80) || undefined;
      if (!next.title && !next.project && !next.hidden) delete f.sessions[key];
      else f.sessions[key] = next;
    }
  });
}

/** Hide sessions from the Projects page, or show them again. Names are kept. */
export async function setHidden(keys: string[], hidden: boolean): Promise<void> {
  await writeNames((f) => {
    for (const key of keys) {
      const cur = f.sessions[key];
      if (hidden) f.sessions[key] = { ...(cur ?? { by: "user" as const, at: Date.now() }), hidden: true };
      else if (cur) {
        const next = { ...cur };
        delete next.hidden;
        if (!next.title && !next.project) delete f.sessions[key];
        else f.sessions[key] = next;
      }
    }
  });
}

// ─── Group with AI ───

let running: Promise<AiNamingResult> | null = null;

export interface AiNamingResult {
  named: number;
  considered: number;
  error?: string;
}

/** Sessions the AI should look at: no project evidence, or a title that is really a prompt. */
export function needsNaming(s: SessionSummary): boolean {
  if (s.indexing) return false;
  if (s.projectSource === "unsorted") return true;
  return s.titleSource !== "user" && looksLikeJunkTitle(s.title);
}

function buildPrompt(cands: SessionSummary[], known: string[]): string {
  const lines = cands.map((s) => {
    const prompt = (s.firstPrompt ?? "").replace(/\s+/g, " ").slice(0, 160);
    const date = new Date(s.startedAt).toISOString().slice(0, 10);
    return `${s.key} | ${date} | title: ${s.title.slice(0, 100)} | first message: ${prompt} | folder: ${s.cwd ? path.basename(s.cwd) : "-"}`;
  });
  return [
    "You organize a person's AI session history (Claude Code and Codex) into projects.",
    "For each session below, choose a short, descriptive PROJECT name (2-4 words, Title Case) — the product, client,",
    "codebase or initiative the work belongs to. Reuse an existing project name when it fits; otherwise make a new one,",
    "and give related sessions the SAME project name so they group together (e.g. all SPHERE dashboard work → one project).",
    "Avoid vague buckets like \"General\", \"Misc\" or \"Home\" unless nothing else fits.",
    "Also give each session a TITLE: a 3-7 word description of what that session did. Keep a good existing title as is.",
    "",
    `Existing projects: ${known.length ? known.join("; ") : "(none yet)"}`,
    "",
    "Sessions (key | date | title | first message | folder):",
    ...lines,
    "",
    'Reply with ONLY a JSON object, no prose: {"sessions":[{"key":"<key>","project":"<project>","title":"<title>"}]}',
  ].join("\n");
}

function parseReply(text: string): { key: string; project?: string; title?: string }[] {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  try {
    const o = JSON.parse(text.slice(start, end + 1)) as { sessions?: { key?: unknown; project?: unknown; title?: unknown }[] };
    return (o.sessions ?? [])
      .filter((x) => typeof x.key === "string")
      .map((x) => ({ key: x.key as string, project: clean(x.project, 60), title: clean(x.title, 100) }));
  } catch {
    return [];
  }
}

/**
 * One Claude run (your subscription, Haiku, not saved as a session) that
 * names up to 150 unsorted / badly-titled sessions. Concurrent callers share
 * the run in progress.
 */
export function aiNameSessions(all: SessionSummary[]): Promise<AiNamingResult> {
  if (running) return running;
  running = (async (): Promise<AiNamingResult> => {
    const cands = all.filter(needsNaming).slice(0, 150);
    if (cands.length === 0) return { named: 0, considered: 0 };
    const known = [...new Set(all.filter((s) => s.projectSource !== "unsorted").map((s) => s.project))].filter((p) => p !== UNSORTED).slice(0, 60);
    const res = await runClaudeText(buildPrompt(cands, known), ["--model", "haiku", "--no-session-persistence"]);
    const valid = new Set(cands.map((c) => c.key));
    const picks = res.error ? [] : parseReply(res.text).filter((p) => valid.has(p.key));
    const byKey = new Map(cands.map((c) => [c.key, c]));
    const rawError = res.error ?? (picks.length === 0 ? "the model returned no usable names" : undefined);
    const error =
      rawError && /authenticat|oauth|log ?in|401/i.test(rawError)
        ? "the Claude Code CLI on this machine is signed out — run `claude` in a terminal, type /login, then try again"
        : rawError;
    await writeNames((f) => {
      for (const p of picks) {
        const cur = f.sessions[p.key];
        if (cur?.by === "user") continue;
        const s = byKey.get(p.key)!;
        f.sessions[p.key] = {
          // only replace what was weak: keep evidence-based projects and good titles
          project: s.projectSource === "unsorted" || s.projectSource === "ai" ? p.project : cur?.project,
          title: s.titleSource !== "user" && (looksLikeJunkTitle(s.title) || s.titleSource === "ai") ? p.title : cur?.title,
          by: "ai",
          at: Date.now(),
        };
      }
      f.lastAiRun = { at: Date.now(), named: picks.length, error };
    });
    return { named: picks.length, considered: cands.length, error };
  })().finally(() => {
    running = null;
  });
  return running;
}
