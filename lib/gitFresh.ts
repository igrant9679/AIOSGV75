import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

/**
 * Bring a folder on THIS machine up to date with GitHub before a task uses it. Found on Raider18: the usip
 * folder was 636 commits behind, and a task answered from that old copy. Fast-forward only, and only when
 * nothing local can be lost: no uncommitted changes to tracked files and no commits GitHub doesn't have.
 */
export function freshenFolder(folder: string): { behind: number; updated: boolean; note?: string } {
  const git = (args: string[], timeout = 60_000) => spawnSync("git", ["-C", folder, ...args], { encoding: "utf8", windowsHide: true, timeout, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
  if (!fs.existsSync(path.join(folder, ".git"))) return { behind: 0, updated: false };
  const f = git(["fetch", "-q", "origin"]);
  if (f.status !== 0) return { behind: 0, updated: false, note: `couldn't check GitHub for newer code (${(f.stderr || "fetch failed").trim().split("\n")[0].slice(0, 120)})` };
  const counts = git(["rev-list", "--left-right", "--count", "HEAD...@{u}"]);
  if (counts.status !== 0) return { behind: 0, updated: false, note: "its branch doesn't follow a GitHub branch, so it wasn't checked" };
  const [ahead, behind] = counts.stdout.trim().split(/\s+/).map(Number);
  if (!behind) return { behind: 0, updated: false };
  const dirty = git(["status", "--porcelain", "--untracked-files=no"]).stdout.trim().length > 0;
  if (dirty || ahead) return { behind, updated: false, note: `it is ${behind} commits behind GitHub and wasn't updated: it has ${dirty ? "uncommitted changes" : ""}${dirty && ahead ? " and " : ""}${ahead ? `${ahead} commit${ahead === 1 ? "" : "s"} GitHub doesn't have` : ""}` };
  const m = git(["merge", "--ff-only", "-q", "@{u}"], 120_000);
  if (m.status !== 0) return { behind, updated: false, note: `it is ${behind} commits behind GitHub and the update failed (${(m.stderr || "").trim().split("\n")[0].slice(0, 120)})` };
  return { behind, updated: true, note: `brought up to date with GitHub first (${behind} commits)` };
}
