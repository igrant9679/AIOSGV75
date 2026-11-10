import fsp from "fs/promises";
import path from "path";

/**
 * OneDrive keeps both sides of a write conflict as "<name>-<PC>-<n>.<ext>" copies. The app
 * never creates names like Status-*.md or lease-*.json itself, so any such file is a stale
 * duplicate that only confuses readers (agents took old copies for a second master).
 * Deleted files go to the OneDrive recycle bin.
 */
export async function sweepConflictCopies(dir: string, pattern: RegExp): Promise<number> {
  let n = 0;
  for (const f of await fsp.readdir(dir).catch(() => [] as string[])) {
    if (!pattern.test(f)) continue;
    await fsp
      .unlink(path.join(dir, f))
      .then(() => n++)
      .catch(() => {});
  }
  return n;
}
