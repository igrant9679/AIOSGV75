import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { vaultInfo } from "@/lib/vault";

/**
 * Operator task board (kanban): pending → in_progress → done.
 * Stored in the vault as "Agentic OS/Tasks.md" so it syncs across machines
 * like shared memory and goals do. The checkbox lines are app-managed;
 * lines added by hand in Obsidian ("- [ ] title" under a lane heading)
 * are adopted, and everything outside the lane sections is preserved.
 * Task identity/timestamps ride in a trailing <!--mc:id:created:updated-->
 * comment (invisible in Obsidian's reading view).
 */
export type BoardStatus = "pending" | "in_progress" | "done";
export const BOARD_STATUSES: BoardStatus[] = ["pending", "in_progress", "done"];

export interface BoardTask {
  id: string;
  title: string;
  status: BoardStatus;
  createdAt: number;
  updatedAt: number;
}

const LANE_HEADINGS: Record<BoardStatus, string> = {
  pending: "## Pending",
  in_progress: "## In Progress",
  done: "## Done",
};

const TASK_LINE_RE = /^\s*-\s*\[( |x|X)\]\s*(.*?)(?:\s*<!--mc:([a-z0-9-]+):(\d+):(\d+)-->)?\s*$/;
const LEGACY_FILE = path.join(process.cwd(), "data", "tasks.json");
const MAX_TASKS = 500;

function boardFile(): string {
  return path.join(vaultInfo().base, "Tasks.md");
}

/** Stable id for hand-added lines so PATCH/DELETE work before first rewrite. */
function derivedId(title: string, status: BoardStatus): string {
  return "task-" + crypto.createHash("sha1").update(`${status}|${title}`).digest("hex").slice(0, 10);
}

export function newTaskId(): string {
  return `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function parseBoard(raw: string): { tasks: BoardTask[]; preamble: string } {
  const tasks: BoardTask[] = [];
  const preambleLines: string[] = [];
  let lane: BoardStatus | null = null;

  for (const line of raw.split(/\r?\n/)) {
    const heading = (Object.entries(LANE_HEADINGS) as [BoardStatus, string][]).find(
      ([, h]) => line.trim().toLowerCase() === h.toLowerCase()
    );
    if (heading) {
      lane = heading[0];
      continue;
    }
    if (/^##\s/.test(line.trim())) {
      lane = null; // some other user-added section — preserve it
      preambleLines.push(line);
      continue;
    }
    const m = lane ? line.match(TASK_LINE_RE) : null;
    if (lane && m && m[2].trim()) {
      const title = m[2].trim().slice(0, 200);
      // A box checked by hand in Obsidian means "done" regardless of lane.
      const status: BoardStatus = m[1].toLowerCase() === "x" ? "done" : lane;
      tasks.push({
        id: m[3] ?? derivedId(title, lane),
        title,
        status,
        createdAt: m[4] ? Number(m[4]) : Date.now(),
        updatedAt: m[5] ? Number(m[5]) : Date.now(),
      });
    } else if (!lane && line.trim()) {
      preambleLines.push(line);
    }
  }
  return { tasks, preamble: preambleLines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() };
}

function renderBoard(tasks: BoardTask[], preamble: string): string {
  const head =
    preamble ||
    [`# Task Board`, ``, `#agentic-os/tasks · [[Agentic OS/Home|Agentic OS]]`, ``, `Synced across machines by the vault. Add lines as "- [ ] title" under a lane and Mission Control adopts them.`].join("\n");
  const lane = (status: BoardStatus) =>
    tasks
      .filter((t) => t.status === status)
      .map((t) => `- [${status === "done" ? "x" : " "}] ${t.title.replace(/\r?\n/g, " ")} <!--mc:${t.id}:${t.createdAt}:${t.updatedAt}-->`)
      .join("\n");
  return [head, "", LANE_HEADINGS.pending, lane("pending"), "", LANE_HEADINGS.in_progress, lane("in_progress"), "", LANE_HEADINGS.done, lane("done"), ""].join("\n");
}

async function migrateLegacy(): Promise<BoardTask[]> {
  try {
    const legacy = JSON.parse(await fs.readFile(LEGACY_FILE, "utf8")) as BoardTask[];
    if (Array.isArray(legacy) && legacy.length > 0) return legacy;
  } catch {
    /* nothing to migrate */
  }
  return [];
}

export async function readTasks(): Promise<{ tasks: BoardTask[]; preamble: string }> {
  try {
    return parseBoard(await fs.readFile(boardFile(), "utf8"));
  } catch {
    // First run on this machine: adopt any pre-vault board from data/tasks.json.
    const migrated = await migrateLegacy();
    if (migrated.length > 0) await writeTasks(migrated, "");
    return { tasks: migrated, preamble: "" };
  }
}

export async function writeTasks(tasks: BoardTask[], preamble: string): Promise<void> {
  const file = boardFile();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, renderBoard(tasks.slice(0, MAX_TASKS), preamble), "utf8");
}
