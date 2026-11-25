import fsp from "fs/promises";
import path from "path";

/**
 * The commands a project trusts as evidence — `npm test`, `npm run build`,
 * `npx tsc --noEmit` — so a project run can prove a task instead of having a
 * second model read about it (lib/runs.ts, phase 2).
 *
 * WHERE THE LIST LIVES IS THE SECURITY BOUNDARY. It is data/project-checks.json
 * on THIS machine, written only through this machine's own page
 * (/api/runs/checks, which is bound to 127.0.0.1 like everything else). It is
 * never read from the vault and never taken from another machine's request:
 * a run, a plan, a worker or a request can only NAME a check, and the name is
 * looked up here. Anything that can write to the vault can therefore ask for a
 * check that exists, and can never introduce a command.
 *
 * What this does NOT protect against, and cannot: a check runs code from the
 * project folder, and a worker with edit access can change that code (or the
 * script a check calls). Allowing a check means allowing whatever the folder's
 * `npm test` does. That is the point of testing agent-written code, and the
 * reason checks are opt-in per folder.
 */

export interface ProjectCheck {
  /** what plans and tasks refer to: "test", "build", "types" */
  name: string;
  command: string;
  timeoutSec: number;
}

const FILE = path.join(process.cwd(), "data", "project-checks.json");
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,29}$/;
const MAX_CHECKS = 8;
export const CHECK_TIMEOUT = { min: 20, default: 600, max: 1140 };

type Store = Record<string, ProjectCheck[]>;

/** One spelling per folder: absolute, no trailing separator, case-folded on Windows. */
export function folderKey(folder: string): string {
  const abs = path.resolve(folder).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? abs.toLowerCase() : abs;
}

async function load(): Promise<Store> {
  try {
    const j = JSON.parse(await fsp.readFile(FILE, "utf8")) as Store;
    return j && typeof j === "object" ? j : {};
  } catch {
    return {};
  }
}

/** No module cache: the tick and the API routes are different module instances (AGENTS.md rule 1). */
export async function readChecks(folder: string): Promise<ProjectCheck[]> {
  if (!folder || folder === "~") return [];
  return (await load())[folderKey(folder)] ?? [];
}

export async function findCheck(folder: string, name: string): Promise<ProjectCheck | undefined> {
  return (await readChecks(folder)).find((c) => c.name === name);
}

/** Replace a folder's checks. Throws with a sentence a person can act on. */
export async function saveChecks(folder: string, input: unknown): Promise<ProjectCheck[]> {
  if (!folder || folder === "~") throw new Error("Checks belong to a project folder, not the home folder.");
  if (!Array.isArray(input)) throw new Error("Send the checks as a list.");
  if (input.length > MAX_CHECKS) throw new Error(`At most ${MAX_CHECKS} checks per folder.`);
  const out: ProjectCheck[] = [];
  for (const raw of input) {
    const c = raw as { name?: unknown; command?: unknown; timeoutSec?: unknown };
    const name = String(c.name ?? "").trim().toLowerCase();
    const command = String(c.command ?? "").trim();
    if (!NAME_RE.test(name)) throw new Error(`"${name || "(empty)"}" isn't a usable name: lower-case letters, digits and dashes, up to 30.`);
    if (out.some((x) => x.name === name)) throw new Error(`Two checks are named "${name}".`);
    if (!command || command.length > 300 || /[\r\n]/.test(command)) throw new Error(`The command for "${name}" must be one line, up to 300 characters.`);
    const t = Number(c.timeoutSec);
    out.push({ name, command, timeoutSec: Number.isFinite(t) ? Math.min(CHECK_TIMEOUT.max, Math.max(CHECK_TIMEOUT.min, Math.round(t))) : CHECK_TIMEOUT.default });
  }
  const store = await load();
  const key = folderKey(folder);
  if (out.length === 0) delete store[key];
  else store[key] = out;
  await fsp.mkdir(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(store, null, 2), "utf8");
  await fsp.rename(tmp, FILE);
  return out;
}
