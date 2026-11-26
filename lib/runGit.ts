import { spawn } from "child_process";
import { cleanEnv } from "./runners";

/**
 * Phase 5 of project runs: a git branch per run.
 *
 * When a run that may edit files works in a folder that is a git repository
 * with nothing uncommitted, it gets its own branch (mc/run-…) before the first
 * task starts. Each task that edits files and passes is committed there on its
 * own, so the history reads task by task; the reviewer of such a task is shown
 * what changed on disk (measured here with git, not described by the worker).
 * At delivery the folder is switched back to the branch it was on, and the
 * delivery says how to look at the work and merge it. Merging stays the owner's.
 *
 * Deliberately conservative:
 *  - a folder with uncommitted changes, no commits yet, or a detached HEAD gets
 *    no branch (the run says so and works as before): the owner's own unfinished
 *    work must never end up inside a run's commit;
 *  - nothing is pushed, merged, rebased, reset or deleted; the only commands are
 *    status/diff/rev-parse, switch -c, add -A, commit and switch back;
 *  - the owner's commit hooks run (no --no-verify); a commit that a hook refuses
 *    is reported, and the changes stay in the folder;
 *  - git runs without a shell, with fixed arguments, in a folder this machine
 *    already uses (the run's folder), with the same cleaned environment as every
 *    other child process (AGENTS.md rule 8).
 */

export interface RunGit {
  /** the run's branch */
  branch: string;
  /** the branch the folder was on, and goes back to at the end */
  base: string;
  baseSha: string;
  startedAt: number;
  commits: { task: string; sha: string; accepted: boolean }[];
  /** set at delivery: the folder is back on `base` */
  returned?: boolean;
}

interface GitOut {
  code: number;
  out: string;
  err: string;
}

function git(cwd: string, args: string[], timeoutMs = 60_000): Promise<GitOut> {
  return new Promise((resolve) => {
    const child = spawn("git", args, { cwd, shell: false, windowsHide: true, env: { ...cleanEnv(), GIT_TERMINAL_PROMPT: "0" } });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on("data", (c: Buffer) => (out = (out + c.toString("utf8")).slice(-200_000)));
    child.stderr.on("data", (c: Buffer) => (err = (err + c.toString("utf8")).slice(-4000)));
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: -1, out, err: e.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, out, err });
    });
  });
}

const firstLine = (s: string) => s.trim().split(/\r?\n/)[0]?.slice(0, 200) ?? "";

/** Make the run's branch and switch the folder to it, or say why not. */
export async function startBranch(folder: string, runId: string): Promise<{ git: RunGit } | { skip: string }> {
  const top = await git(folder, ["rev-parse", "--show-toplevel"]);
  if (top.code !== 0) return { skip: "the folder is not a git repository" };
  const status = await git(folder, ["status", "--porcelain"]);
  if (status.code !== 0) return { skip: `git status failed (${firstLine(status.err)})` };
  if (status.out.trim()) return { skip: "the folder has uncommitted changes, and those must not end up in the run's commits" };
  const base = await git(folder, ["symbolic-ref", "--short", "-q", "HEAD"]);
  if (base.code !== 0 || !base.out.trim()) return { skip: "the repository is not on a branch (detached HEAD)" };
  const sha = await git(folder, ["rev-parse", "HEAD"]);
  if (sha.code !== 0) return { skip: "the repository has no commits yet" };
  // "2026-11-25 tidy the readme ab12" → mc/run-2026-11-25-tidy-the-readme-ab12
  const stem = `mc/run-${runId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60)}`;
  let branch = stem;
  for (let i = 2; i < 9; i++) {
    const exists = await git(folder, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
    if (exists.code !== 0) break;
    branch = `${stem}-${i}`;
  }
  const fmt = await git(folder, ["check-ref-format", "--branch", branch]);
  if (fmt.code !== 0) return { skip: `could not make a valid branch name (${branch})` };
  const sw = await git(folder, ["switch", "-c", branch]);
  if (sw.code !== 0) return { skip: `git could not create the branch (${firstLine(sw.err)})` };
  return { git: { branch, base: base.out.trim(), baseSha: sha.out.trim(), startedAt: Date.now(), commits: [] } };
}

/** Which branch the folder is on now ("" if it can't tell). */
async function currentBranch(folder: string): Promise<string> {
  const r = await git(folder, ["symbolic-ref", "--short", "-q", "HEAD"]);
  return r.code === 0 ? r.out.trim() : "";
}

/**
 * What changed on disk since the last commit on the run's branch: the file list (new files
 * included) and the diff itself, clipped. "" when nothing changed or git can't say.
 */
export async function workingDiff(folder: string, max = 6000): Promise<string> {
  const status = await git(folder, ["status", "--porcelain", "--untracked-files=all"]);
  if (status.code !== 0 || !status.out.trim()) return "";
  const stat = await git(folder, ["diff", "HEAD", "--stat"]);
  const diff = await git(folder, ["diff", "HEAD"]);
  const untracked = status.out
    .split(/\r?\n/)
    .filter((l) => l.startsWith("??"))
    .map((l) => l.slice(3));
  const parts = [`Files changed (git status):\n${status.out.trim()}`, stat.out.trim() ? `\n${stat.out.trim()}` : "", untracked.length ? `\nNew files not shown in the diff below: ${untracked.join(", ")}` : "", diff.out.trim() ? `\n${diff.out.trim()}` : ""].join("\n");
  return parts.length > max ? `${parts.slice(0, max)}\n…(the system cut the diff here at ${max.toLocaleString()} characters)` : parts;
}

/** Commit everything in the folder on the run's branch. Nothing changed = nothing to do. */
export async function commitAll(folder: string, g: RunGit, message: string): Promise<{ sha?: string; error?: string }> {
  const now = await currentBranch(folder);
  if (now !== g.branch) return { error: `the folder is on "${now || "no branch"}", not the run's branch ${g.branch}; nothing was committed` };
  const add = await git(folder, ["add", "-A"]);
  if (add.code !== 0) return { error: `git add failed (${firstLine(add.err)})` };
  const staged = await git(folder, ["diff", "--cached", "--quiet"]);
  if (staged.code === 0) return {}; // nothing staged
  // a machine with no git identity still gets a commit, signed as the app
  const email = await git(folder, ["config", "user.email"]);
  const who = email.out.trim() ? [] : ["-c", "user.name=Mission Control", "-c", "user.email=mission-control@localhost"];
  const c = await git(folder, [...who, "commit", "-q", "-m", message.slice(0, 300)], 180_000);
  if (c.code !== 0) return { error: `git commit failed (${firstLine(c.err) || firstLine(c.out) || `exit ${c.code}`})` };
  const sha = await git(folder, ["rev-parse", "--short", "HEAD"]);
  return { sha: sha.out.trim() };
}

/**
 * The end of a run: anything left uncommitted is committed as not accepted (so it is kept,
 * and kept apart), then the folder goes back to the branch it was on. Returns a sentence for
 * the delivery.
 */
export async function finishBranch(folder: string, g: RunGit): Promise<{ note: string; returned: boolean; leftover?: string }> {
  const left = await commitAll(folder, g, `Run left this uncommitted (not accepted by review)`);
  const accepted = g.commits.filter((c) => c.accepted).length + 0;
  const now = await currentBranch(folder);
  const how = `To look at it: git log ${g.base}..${g.branch}. To take it: git merge ${g.branch} (from ${g.base}).`;
  if (now !== g.branch) {
    return { returned: false, leftover: left.sha, note: `The run's work is on the branch ${g.branch}; the folder is now on "${now || "no branch"}", so it was left as it is. ${how}` };
  }
  const sw = await git(folder, ["switch", g.base]);
  if (sw.code !== 0) {
    return { returned: false, leftover: left.sha, note: `The run's work is on the branch ${g.branch}, and the folder is still on it: git could not switch back to ${g.base} (${firstLine(sw.err)}). ${how}` };
  }
  const count = await git(folder, ["rev-list", "--count", `${g.base}..${g.branch}`]);
  const n = Number(count.out.trim()) || 0;
  return {
    returned: true,
    leftover: left.sha,
    note:
      n === 0
        ? `The run changed no files, so its branch ${g.branch} has nothing on it. The folder is back on ${g.base}.`
        : `The run's work is on the branch ${g.branch}: ${n} commit${n === 1 ? "" : "s"}${accepted ? `, ${accepted} for task${accepted === 1 ? "" : "s"} that passed` : ""}${left.sha ? ", the last one holding work that was not accepted" : ""}. The folder is back on ${g.base}, unchanged. ${how}`,
  };
}
