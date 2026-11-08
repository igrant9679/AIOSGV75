import fsp from "fs/promises";
import os from "os";
import path from "path";
import { vaultInfo } from "./vault";

/**
 * Read-only mirror of each tool's OWN memory files into the vault, so every
 * machine (and the vault search, and agents' retrieval) can see what Claude
 * Code and Codex have learned on each machine:
 *
 *   ~/.claude/CLAUDE.md                     → Tool Memory/<machine>/Claude/CLAUDE.md
 *   ~/.claude/projects/<p>/memory/*.md      → Tool Memory/<machine>/Claude/<project>/*.md
 *   ~/.codex/AGENTS.md, ~/.codex/memories/  → Tool Memory/<machine>/Codex/…
 *
 * One-way: the originals are never written. Mirrors are refreshed when the
 * source changes and removed when the source is deleted.
 */

const HOME = os.homedir();

export function toolMemoryRoot(): string {
  return path.join(vaultInfo().base, "Tool Memory");
}

/** "C--Users-idris-Documents" → "Documents"; "C--Users-idris" → "Home folder"; scratch → "Scratch 2026-11-08". */
function projectLabel(encoded: string): string {
  const scratch = encoded.match(/scratch-(\d{4}-\d{2}-\d{2})-([0-9a-f]{4,})$/i);
  if (scratch) return `Scratch ${scratch[1]} ${scratch[2].slice(0, 4)}`;
  const rest = encoded.replace(/^[A-Za-z]--(?:Users|home)-[^-]+-?/, "");
  if (!rest) return "Home folder";
  return rest.replace(/^[A-Za-z]--/, "").replace(/-/g, " ").trim().slice(0, 80) || encoded;
}

interface Source {
  from: string;
  rel: string; // path under Tool Memory/<machine>/
  tool: "Claude" | "Codex";
}

async function listMd(dir: string, depth = 2): Promise<string[]> {
  const out: string[] = [];
  let entries: import("fs").Dirent[] = [];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory() && depth > 0) out.push(...(await listMd(p, depth - 1)));
    else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) out.push(p);
  }
  return out;
}

async function sources(): Promise<Source[]> {
  const out: Source[] = [];
  const add = async (from: string, rel: string, tool: Source["tool"]) => {
    if (await fsp.stat(from).then((s) => s.isFile()).catch(() => false)) out.push({ from, rel, tool });
  };
  await add(path.join(HOME, ".claude", "CLAUDE.md"), path.join("Claude", "CLAUDE.md"), "Claude");
  const projects = path.join(HOME, ".claude", "projects");
  for (const p of await fsp.readdir(projects).catch(() => [] as string[])) {
    for (const f of await listMd(path.join(projects, p, "memory"), 1)) {
      out.push({ from: f, rel: path.join("Claude", projectLabel(p), path.relative(path.join(projects, p, "memory"), f)), tool: "Claude" });
    }
  }
  await add(path.join(HOME, ".codex", "AGENTS.md"), path.join("Codex", "AGENTS.md"), "Codex");
  for (const f of await listMd(path.join(HOME, ".codex", "memories"))) {
    out.push({ from: f, rel: path.join("Codex", "memories", path.relative(path.join(HOME, ".codex", "memories"), f)), tool: "Codex" });
  }
  return out;
}

/** Copy changed memory files into the vault; drop mirrors whose source is gone. Returns files written. */
export async function mirrorToolMemory(machine: string): Promise<number> {
  const root = path.join(toolMemoryRoot(), machine.replace(/[\\/:*?"<>|]+/g, " ").trim());
  const list = await sources();
  const keep = new Set<string>();
  let written = 0;
  for (const s of list) {
    const target = path.join(root, s.rel);
    keep.add(target.toLowerCase());
    try {
      const [src, dst] = await Promise.all([fsp.stat(s.from), fsp.stat(target).catch(() => null)]);
      if (dst && dst.mtimeMs >= src.mtimeMs) continue;
      const text = await fsp.readFile(s.from, "utf8");
      const header = `<!-- Mirrored by Mission Control from ${machine}: ${s.from.replace(HOME, "~")} — read-only copy, edit the original -->\n\n`;
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, header + text, "utf8");
      written++;
    } catch {
      /* unreadable now — next pass */
    }
  }
  // prune mirrors whose source was deleted (only inside this machine's folder)
  for (const f of await listMd(root, 6)) {
    if (!keep.has(f.toLowerCase())) await fsp.unlink(f).catch(() => {});
  }
  return written;
}

/** Per-machine counts for the Fleet page. */
export async function toolMemoryCounts(): Promise<{ machine: string; claude: number; codex: number }[]> {
  const out: { machine: string; claude: number; codex: number }[] = [];
  for (const m of await fsp.readdir(toolMemoryRoot()).catch(() => [] as string[])) {
    const base = path.join(toolMemoryRoot(), m);
    out.push({ machine: m, claude: (await listMd(path.join(base, "Claude"), 4)).length, codex: (await listMd(path.join(base, "Codex"), 4)).length });
  }
  return out;
}
