import fs from "fs/promises";
import path from "path";

/**
 * Operator task board (kanban): pending → in_progress → done.
 * data/tasks.json is the source of truth — read fresh on every request,
 * never module-cached (instrumentation and route bundles are separate
 * module instances).
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

const FILE = path.join(process.cwd(), "data", "tasks.json");
const MAX_TASKS = 500;

export async function readTasks(): Promise<BoardTask[]> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8")) as BoardTask[];
  } catch {
    return [];
  }
}

export async function writeTasks(tasks: BoardTask[]): Promise<void> {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(tasks.slice(0, MAX_TASKS), null, 2), "utf8");
}

export function newTaskId(): string {
  return `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
