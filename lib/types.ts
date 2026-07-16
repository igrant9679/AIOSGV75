export type PermissionMode = "default" | "acceptEdits" | "plan" | "bypassPermissions";

export interface SystemStats {
  cpu: number; // 0..100
  memUsed: number; // bytes
  memTotal: number; // bytes
  uptime: number; // seconds
  platform: string;
  hostname: string;
  claudeVersion: string | null;
  diskUsed?: number; // bytes
  diskTotal?: number; // bytes
  dataBytes?: number; // total size of data/*.json stores
}

export interface ClaudeRunOptions {
  prompt: string;
  sessionId?: string;
  model?: string;
  permissionMode?: PermissionMode;
  cwd?: string;
}

/** Simplified view of Claude Code stream-json events we care about on the client. */
export interface ConsoleEntry {
  id: string;
  role: "user" | "assistant" | "tool" | "system" | "error";
  text: string;
  meta?: string;
  ts: number;
}

export interface RunStats {
  totalCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  turns: number;
  durationMs: number;
  runs: number;
}

export interface LlmInfo {
  id: string;
  name: string;
  provider: string;
  baseUrl: string;
  model: string;
  hasKey: boolean;
  accent: "cyan" | "magenta" | "amber" | "lime" | "violet" | "rose";
  systemPrompt?: string;
}

export interface CommandAgentInfo {
  id: string;
  name: string;
  tagline: string;
  accent: "cyan" | "magenta" | "amber" | "lime" | "violet" | "rose";
  binary: string;
  commandTemplate: string;
}

export interface RegistryInfo {
  llms: LlmInfo[];
  commandAgents: CommandAgentInfo[];
  workspaces: string[];
}

export interface AgentInfo {
  id: string;
  name: string;
  tagline: string;
  accent: "cyan" | "magenta" | "amber" | "lime" | "violet" | "rose";
  binary: string;
  commandTemplate: string;
  available: boolean;
  version: string | null;
  /** Diagnostic for an offline agent (e.g. the configured path names another user). */
  hint?: string;
}
