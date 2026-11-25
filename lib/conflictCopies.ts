import fsp from "fs/promises";
import path from "path";
import { vaultInfo } from "./vault";

/**
 * OneDrive keeps both sides of a write conflict as "<name>-<PC>-<n>.<ext>" copies. The app
 * never creates names like Status-*.md or lease-*.json itself, so any such file is a stale
 * duplicate that only confuses readers (agents took old copies for a second master).
 * Deleted files go to the OneDrive recycle bin.
 */
export async function sweepConflictCopies(dir: string, pattern: RegExp, opts: { dryRun?: boolean } = {}): Promise<number> {
  let n = 0;
  for (const f of await fsp.readdir(dir).catch(() => [] as string[])) {
    if (!pattern.test(f)) continue;
    if (opts.dryRun) {
      n++;
      continue;
    }
    await fsp
      .unlink(path.join(dir, f))
      .then(() => n++)
      .catch(() => {});
  }
  return n;
}

/**
 * Conflict copies of notes the app GENERATES under one fixed name. Each of them is
 * rebuilt from data, so the copy is never the only place something lives:
 *
 *   Home-<PC>.md, Guide-<PC>.md             rewritten daily (Guide copies alone were ~1,000
 *                                           passages of the search index — duplicates of the manual)
 *   <date> Machines-<PC>.md                 the daily machines summary
 *   <YYYY>-W<ww>-<PC>.md                    the weekly roll-up
 *   <date> <time> <slug>-<PC>.md            a mission log: two masters ran the same scheduled
 *                                           job in the same minute. The app's own slugs are
 *                                           lower-case, so a capital letter after the timestamp
 *                                           can only be a machine name.
 *
 * NOT swept, on purpose: Memory, Goals, Tasks, Rules, Journal, the profile. Those hold what
 * you or an agent wrote, and a conflict copy of one may be the only place an edit survives.
 */
export async function sweepGeneratedCopies(opts: { dryRun?: boolean } = {}): Promise<number> {
  const base = vaultInfo().base;
  const jobs: [string, RegExp][] = [
    [base, /^(Home|Guide)-.+\.md$/],
    [path.join(base, "Daily Summaries"), /^\d{4}-\d{2}-\d{2} Machines-.+\.md$/],
    [path.join(base, "Weekly"), /^\d{4}-W\d{2}-.+\.md$/],
    [path.join(base, "Missions"), /^\d{4}-\d{2}-\d{2} \d{2}-\d{2} \S*-\S*[A-Z]\S*\.md$/],
  ];
  let n = 0;
  for (const [dir, pattern] of jobs) n += await sweepConflictCopies(dir, pattern, opts).catch(() => 0);
  return n;
}
