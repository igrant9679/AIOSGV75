/**
 * Where a Claude Code / Codex session was started, from the `entrypoint`
 * (Claude) or `originator` (Codex) its session file records. Client-safe —
 * no fs — so the hub pages can label rows from SessionSummary.origin too.
 */
export type LaunchSurface = "desktop" | "terminal" | "ide" | "background" | "other";

export const LAUNCH_SURFACE_META: Record<LaunchSurface, { label: string; hint: string }> = {
  desktop: { label: "Desktop app", hint: "Started in the Claude or Codex desktop app" },
  terminal: { label: "Terminal", hint: "Started from the claude / codex command in a terminal" },
  ide: { label: "IDE", hint: "Started from a VS Code or JetBrains extension" },
  background: {
    label: "Background",
    hint: "Headless runs (claude -p, codex exec, SDK) — Mission Control's agents and schedules, plus any scripts",
  },
  other: { label: "Other", hint: "Launch point not recorded in the session file" },
};

export const LAUNCH_SURFACE_ORDER: LaunchSurface[] = ["desktop", "terminal", "ide", "background", "other"];

export function launchSurface(origin: string | undefined): LaunchSurface {
  const o = (origin ?? "").toLowerCase();
  if (!o) return "other";
  if (/desktop/.test(o)) return "desktop"; // claude-desktop, Codex Desktop
  if (/vscode|jetbrains|ide|cursor|windsurf/.test(o)) return "ide"; // claude-vscode, codex_vscode
  if (/^sdk|exec|headless|mcp|action/.test(o)) return "background"; // sdk-cli, sdk-ts, codex_exec, github action
  if (/^cli$|cli_rs|_cli$|^codex$|tui/.test(o)) return "terminal"; // cli, codex_cli_rs
  return "other";
}
