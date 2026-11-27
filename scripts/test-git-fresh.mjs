import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Tests lib/gitFresh.ts (Work brings a folder up to date before a task uses it) on throwaway repositories:
// an "origin", and clones of it that are current, behind, behind with local changes, and ahead.
// Run: node scripts/test-git-fresh.mjs
const here = path.dirname(fileURLToPath(import.meta.url));
const { freshenFolder } = await import(pathToFileURL(path.join(here, "..", "lib", "gitFresh.ts")).href);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mc-gitfresh-"));
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const id = ["-c", "user.name=test", "-c", "user.email=test@example.invalid"];
const origin = path.join(tmp, "origin.git");
const work = path.join(tmp, "work");
git(tmp, "init", "-q", "--bare", "-b", "main", origin);
git(tmp, "clone", "-q", origin, work);
fs.writeFileSync(path.join(work, "a.txt"), "1\n");
git(work, "add", "a.txt");
git(work, ...id, "commit", "-q", "-m", "first");
git(work, "push", "-q", "origin", "HEAD:main");
const clone = (name) => {
  const d = path.join(tmp, name);
  git(tmp, "clone", "-q", origin, d);
  return d;
};
const current = clone("current");
const behind = clone("behind");
const dirty = clone("dirty");
const ahead = clone("ahead");
// two new commits on GitHub ("origin")
for (const n of [2, 3]) {
  fs.writeFileSync(path.join(work, "a.txt"), `${n}\n`);
  git(work, ...id, "commit", "-q", "-am", `commit ${n}`);
}
git(work, "push", "-q", "origin", "HEAD:main");
git(current, "pull", "-q");
fs.writeFileSync(path.join(dirty, "a.txt"), "my local edit\n");
fs.writeFileSync(path.join(ahead, "b.txt"), "local\n");
git(ahead, "add", "b.txt");
git(ahead, ...id, "commit", "-q", "-m", "local only");

let n = 0;
const t = (name, fn) => {
  fn();
  console.log(`ok ${++n} - ${name}`);
};
try {
  t("a current folder is left alone", () => {
    assert.deepEqual(freshenFolder(current), { behind: 0, updated: false });
  });
  t("a clean folder that is behind is fast-forwarded", () => {
    const r = freshenFolder(behind);
    assert.equal(r.behind, 2);
    assert.equal(r.updated, true);
    assert.equal(fs.readFileSync(path.join(behind, "a.txt"), "utf8").trim(), "3"); // git may check out with CRLF on Windows
  });
  t("uncommitted changes: not updated, nothing touched", () => {
    const r = freshenFolder(dirty);
    assert.equal(r.updated, false);
    assert.equal(r.behind, 2);
    assert.match(r.note, /uncommitted changes/);
    assert.equal(fs.readFileSync(path.join(dirty, "a.txt"), "utf8").trim(), "my local edit");
  });
  t("local commits GitHub doesn't have: not updated", () => {
    const r = freshenFolder(ahead);
    assert.equal(r.updated, false);
    assert.match(r.note, /1 commit GitHub doesn't have/);
  });
  t("not a git folder: nothing to do", () => {
    assert.deepEqual(freshenFolder(tmp), { behind: 0, updated: false });
  });
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`\n${n} tests passed`);
