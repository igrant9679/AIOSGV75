import fsp from "fs/promises";
import os from "os";
import path from "path";
import { findSessionFile, sessionsSnapshot, type SessionTool } from "./sessions";

/**
 * Hand a Claude Code session to another machine: copy its transcript into the
 * other machine's ~/.claude/projects/<folder>/<id>.jsonl, with the folder
 * paths rewritten to where the project lives THERE, so `claude --resume <id>`
 * continues it on that machine with the whole conversation.
 *
 * Codex sessions aren't supported: the Codex app keeps its own thread index,
 * so a copied rollout file wouldn't show up reliably.
 */

const MAX_BYTES = 50 * 1024 * 1024;

export interface HandoffPackage {
  key: string;
  id: string;
  tool: SessionTool;
  cwd: string;
  title: string;
  project: string;
  content: string;
}

/** Claude Code's folder naming under ~/.claude/projects (C:\a\b-c → C--a-b-c). */
export const encodeProjectDir = (cwd: string) => cwd.replace(/[^a-zA-Z0-9]/g, "-");

export async function exportSession(key: string): Promise<HandoffPackage> {
  const snap = await sessionsSnapshot();
  const s = snap.sessions.find((x) => x.key === key);
  if (!s) throw new Error("That session isn't on this machine.");
  if (s.tool !== "claude") throw new Error("Only Claude Code sessions can be moved between machines (the Codex app keeps its own index).");
  const file = await findSessionFile(key);
  if (!file) throw new Error("The session file couldn't be found.");
  const st = await fsp.stat(file);
  if (st.size > MAX_BYTES) throw new Error(`That session is too large to move (${Math.round(st.size / 1e6)} MB, max 50 MB).`);
  return { key: s.key, id: s.id, tool: s.tool, cwd: s.cwd, title: s.title, project: s.project, content: await fsp.readFile(file, "utf8") };
}

const jsonEsc = (s: string) => JSON.stringify(s).slice(1, -1);

/** Write a handed-off session into this machine's Claude Code history. Returns its key. */
export async function importSession(pkg: Pick<HandoffPackage, "id" | "tool" | "cwd" | "content">, targetCwd: string): Promise<{ key: string; cwd: string }> {
  if (pkg.tool !== "claude") throw new Error("Only Claude Code sessions can be moved between machines.");
  if (!/^[\w-]{8,80}$/.test(pkg.id)) throw new Error("Bad session id.");
  const cwd = !targetCwd || targetCwd === "~" ? os.homedir() : targetCwd;
  const st = await fsp.stat(cwd).catch(() => null);
  if (!st?.isDirectory()) throw new Error(`The folder ${cwd} doesn't exist on ${os.hostname()}. Create it (or clone the project there) first.`);
  if (!pkg.content || pkg.content.length > MAX_BYTES) throw new Error("Nothing to import (or too large).");

  // rewrite the old folder to the new one everywhere it appears (cwd fields, file paths in tool calls)
  let content = pkg.content;
  if (pkg.cwd && pkg.cwd !== cwd) content = content.split(jsonEsc(pkg.cwd)).join(jsonEsc(cwd));

  const key = `claude:${pkg.id}`;
  const existing = await findSessionFile(key);
  if (existing) {
    const est = await fsp.stat(existing).catch(() => null);
    if (est && est.size >= Buffer.byteLength(content)) throw new Error(`${os.hostname()} already has this session (the same or a longer copy).`);
  }
  const dir = path.join(os.homedir(), ".claude", "projects", encodeProjectDir(cwd));
  await fsp.mkdir(dir, { recursive: true });
  const file = existing && path.dirname(existing) === dir ? existing : path.join(dir, `${pkg.id}.jsonl`);
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, content, "utf8");
  await fsp.rename(tmp, file);
  return { key, cwd };
}
