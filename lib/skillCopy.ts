import crypto from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";

/**
 * Copying a skill from one machine to another (Fleet → Setup → Copy).
 *
 * Only your own skills (~/.claude/skills/<name>, a folder with a SKILL.md) travel; plugin skills
 * come with their plugin. The folder is packed whole on the machine that has it and unpacked on
 * the other. A skill can carry scripts Claude may run, so installing one is a setup change with
 * access "edit": another machine may do it only where "Answers + file edits" is allowed (AGENTS.md
 * rule 33).
 *
 * Unpacking is careful: names and paths are checked (no "..", no absolute paths, no links), it is
 * written to a staging folder first and moved into place in one step, and a different skill of
 * the same name is never overwritten unless asked, and even then kept: it moves to
 * ~/.claude/skills-replaced/, outside the skills folder so Claude doesn't load it.
 */

export interface SkillFile {
  path: string; // forward slashes, relative to the skill folder
  b64: string;
}

export interface SkillPackage {
  v: 1;
  name: string;
  fromHost: string;
  fromLabel?: string;
  hash: string;
  bytes: number;
  files: SkillFile[];
}

export const SKILL_NAME_RE = /^[A-Za-z0-9_][\w.-]{0,99}$/;
const MAX_FILES = 400;
const MAX_BYTES = 8 * 1024 * 1024;
const SKIP_DIRS = new Set([".git", "node_modules", "__pycache__", ".venv", "venv", ".mypy_cache", ".pytest_cache"]);

const claudeDir = () => path.join(os.homedir(), ".claude");
export const skillsRoot = () => path.join(claudeDir(), "skills");

/** Files of a skill folder, sorted, links and junk folders left out; throws past the size limits. */
function walk(root: string): { rel: string; abs: string; size: number }[] {
  const out: { rel: string; abs: string; size: number }[] = [];
  let bytes = 0;
  const visit = (dir: string, rel: string) => {
    for (const d of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (d.isSymbolicLink()) continue;
      const abs = path.join(dir, d.name);
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) {
        if (!SKIP_DIRS.has(d.name)) visit(abs, r);
        continue;
      }
      if (!d.isFile()) continue;
      const size = fs.statSync(abs).size;
      bytes += size;
      out.push({ rel: r, abs, size });
      if (out.length > MAX_FILES) throw new Error(`That skill has more than ${MAX_FILES} files; too big to copy this way.`);
      if (bytes > MAX_BYTES) throw new Error(`That skill is over ${MAX_BYTES / 1024 / 1024} MB; too big to copy this way.`);
    }
  };
  visit(root, "");
  return out;
}

const hashFiles = (files: { path: string; data: Buffer }[]) => {
  const h = crypto.createHash("sha256");
  for (const f of [...files].sort((a, b) => a.path.localeCompare(b.path))) h.update(f.path).update("\0").update(f.data).update("\0");
  return h.digest("hex").slice(0, 16);
};

/** A fingerprint of a skill's contents, so two machines can tell whether their copies match. */
export function skillHash(name: string): string | undefined {
  if (!SKILL_NAME_RE.test(name)) return undefined;
  const root = path.join(skillsRoot(), name);
  try {
    return hashFiles(walk(root).map((f) => ({ path: f.rel, data: fs.readFileSync(f.abs) })));
  } catch {
    return undefined;
  }
}

/** Pack one of this machine's own skills. */
export function packSkill(name: string, fromLabel?: string): SkillPackage {
  if (!SKILL_NAME_RE.test(name)) throw new Error("bad skill name");
  const root = path.join(skillsRoot(), name);
  if (!fs.existsSync(path.join(root, "SKILL.md"))) throw new Error(`There's no skill called ${name} in this machine's ~/.claude/skills.`);
  const files = walk(root).map((f) => ({ path: f.rel, data: fs.readFileSync(f.abs) }));
  return {
    v: 1,
    name,
    fromHost: os.hostname(),
    fromLabel,
    hash: hashFiles(files),
    bytes: files.reduce((n, f) => n + f.data.length, 0),
    files: files.map((f) => ({ path: f.path, b64: f.data.toString("base64") })),
  };
}

/** A relative path inside the skill: no drive, no root, no "..", nothing odd. */
function safeRel(p: unknown): string | null {
  if (typeof p !== "string" || !p || p.length > 300 || p.includes("\0") || p.includes("\\")) return null;
  if (p.startsWith("/") || /^[A-Za-z]:/.test(p)) return null;
  const parts = p.split("/");
  if (parts.some((s) => !s || s === "." || s === ".." || /[<>:"|?*]/.test(s))) return null;
  return parts.join(path.sep);
}

/**
 * Unpack a skill here. Checks everything in the package itself (never trusts its stated hash or
 * size). `replace` = a different skill of that name may be swapped out (the old one is kept).
 */
export async function installSkill(pkg: SkillPackage, opts: { replace?: boolean } = {}): Promise<string> {
  if (!pkg || pkg.v !== 1 || !SKILL_NAME_RE.test(pkg.name) || !Array.isArray(pkg.files)) throw new Error("bad skill package");
  if (pkg.files.length === 0 || pkg.files.length > MAX_FILES) throw new Error("bad skill package (file count)");
  const decoded: { rel: string; path: string; data: Buffer }[] = [];
  let bytes = 0;
  const seen = new Set<string>();
  for (const f of pkg.files) {
    const rel = safeRel(f?.path);
    if (!rel || typeof f.b64 !== "string") throw new Error(`bad path in skill package: ${String(f?.path).slice(0, 80)}`);
    if (seen.has(rel.toLowerCase())) throw new Error("bad skill package (a file twice)");
    seen.add(rel.toLowerCase());
    const data = Buffer.from(f.b64, "base64");
    bytes += data.length;
    if (bytes > MAX_BYTES) throw new Error("bad skill package (too big)");
    decoded.push({ rel, path: f.path, data });
  }
  if (!decoded.some((f) => f.path === "SKILL.md")) throw new Error("That package has no SKILL.md, so it isn't a skill.");
  const hash = hashFiles(decoded.map((f) => ({ path: f.path, data: f.data })));

  const dest = path.join(skillsRoot(), pkg.name);
  const from = pkg.fromLabel || pkg.fromHost || "the other machine";
  const exists = fs.existsSync(dest);
  if (exists) {
    if (skillHash(pkg.name) === hash) return `${pkg.name} is already here, identical to ${from}'s. Nothing changed.`;
    if (!opts.replace) throw new Error(`This machine already has a different skill called ${pkg.name}. Copy again with "replace" to swap it (the old one is kept in ~/.claude/skills-replaced).`);
  }

  // stage outside the skills folder, then move into place in one step
  const stage = path.join(claudeDir(), ".mc-skill-staging", `${pkg.name}-${Date.now().toString(36)}`);
  try {
    for (const f of decoded) {
      const abs = path.join(stage, f.rel);
      if (!abs.startsWith(stage + path.sep)) throw new Error("bad path in skill package");
      await fsp.mkdir(path.dirname(abs), { recursive: true });
      await fsp.writeFile(abs, f.data);
    }
    let kept = "";
    let bak = "";
    if (exists) {
      bak = path.join(claudeDir(), "skills-replaced", `${pkg.name}-${new Date().toISOString().replace(/[:.]/g, "-")}`);
      await fsp.mkdir(path.dirname(bak), { recursive: true });
      await fsp.rename(dest, bak);
      kept = ` The one it replaced is kept in ${bak}.`;
    }
    await fsp.mkdir(skillsRoot(), { recursive: true });
    try {
      await fsp.rename(stage, dest);
    } catch (e) {
      if (bak) await fsp.rename(bak, dest).catch(() => {}); // put the old one back
      throw new Error(`Couldn't move the skill into place (${(e as Error).message}). Nothing changed.`);
    }
    return `Copied ${pkg.name} from ${from} (${decoded.length} file${decoded.length === 1 ? "" : "s"}, ${Math.max(1, Math.round(bytes / 1024))} KB). New Claude sessions here can use it.${kept}`;
  } finally {
    await fsp.rm(stage, { recursive: true, force: true }).catch(() => {});
  }
}
