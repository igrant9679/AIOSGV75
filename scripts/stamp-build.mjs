// After `next build`: record which commit was built, so the running server can say what it
// serves (lib/selfUpdate.ts → Fleet → Versions). The commit in the folder is not enough:
// code can be pulled and not yet built, or built and not yet restarted.
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

const git = (...args) => {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 15_000 }).trim();
  } catch {
    return "";
  }
};

const commit = git("rev-parse", "HEAD");
const [subject = "", at = "0"] = git("log", "-1", "--format=%s%x1f%ct").split("\x1f");
const info = {
  commit,
  short: commit.slice(0, 7),
  subject: subject.slice(0, 160),
  at: Number(at) * 1000,
  branch: git("branch", "--show-current"),
  dirty: git("status", "--porcelain", "--untracked-files=no") !== "",
  builtAt: Date.now(),
};
const dir = path.join(process.cwd(), ".next");
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "mc-build.json"), JSON.stringify(info, null, 2));
console.log(`[mission-control] build stamped: ${info.short || "(no git)"} ${info.subject}`);
