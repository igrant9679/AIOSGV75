import type { ActivityItem } from "@/lib/activity";
import type { SessionSummary } from "@/lib/sessions";
import type { SortOption } from "./SortControl";
import { SOURCE_META } from "./common";

/** Shared sort keys for the second-brain lists (see SortControl.useSort). */

/** Status sort: what needs you first. */
const STATUS_ORDER: Record<string, number> = { waiting: 0, running: 1, error: 2, idle: 3, done: 4, ended: 4 };

export const ACTIVITY_SORTS: SortOption<ActivityItem>[] = [
  { id: "changed", label: "Last changed", get: (i) => i.ts, dir: "desc", time: true },
  { id: "created", label: "Created", get: (i) => i.startedAt ?? i.ts, dir: "desc", time: true },
  { id: "opened", label: "Last opened", get: (i) => i.lastOpenedAt, dir: "desc", time: true },
  { id: "title", label: "Title", get: (i) => i.title, dir: "asc" },
  { id: "project", label: "Project", get: (i) => i.project, dir: "asc" },
  { id: "tool", label: "Tool", get: (i) => SOURCE_META[i.source].label, dir: "asc" },
  { id: "status", label: "Status", get: (i) => STATUS_ORDER[i.status], dir: "asc" },
];

export const SESSION_SORTS: SortOption<SessionSummary>[] = [
  { id: "changed", label: "Last changed", get: (s) => s.updatedAt, dir: "desc", time: true },
  { id: "created", label: "Created", get: (s) => s.startedAt, dir: "desc", time: true },
  { id: "opened", label: "Last opened", get: (s) => s.lastOpenedAt, dir: "desc", time: true },
  { id: "title", label: "Title", get: (s) => s.title, dir: "asc" },
  { id: "project", label: "Project", get: (s) => s.project, dir: "asc" },
  { id: "prompts", label: "Prompts", get: (s) => s.userTurns, dir: "desc" },
  { id: "tokens", label: "Tokens", get: (s) => s.tokensIn + s.tokensOut, dir: "desc" },
  { id: "status", label: "Status", get: (s) => STATUS_ORDER[s.status], dir: "asc" },
];
