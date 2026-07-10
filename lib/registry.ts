import fs from "fs/promises";
import path from "path";
import type { Accent } from "./accents";

/**
 * User-managed registry: custom LLM connections, custom command agents, and
 * workspaces. Lives in data/registry.json (git-ignored — it holds API keys).
 */
export interface LlmConfig {
  id: string;
  name: string;
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  accent: Accent;
  systemPrompt?: string;
}

export interface CommandAgentConfig {
  id: string;
  name: string;
  tagline: string;
  accent: Accent;
  binary: string;
  commandTemplate: string;
}

export interface Registry {
  llms: LlmConfig[];
  commandAgents: CommandAgentConfig[];
  workspaces: string[];
}

const FILE = path.join(process.cwd(), "data", "registry.json");
const EMPTY: Registry = { llms: [], commandAgents: [], workspaces: ["Default"] };

export const ACCENT_IDS = ["cyan", "magenta", "amber", "lime", "violet", "rose"] as const;
export const WORKSPACE_RE = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,39}$/;
/** Built-in chat ids that dynamic agents must not shadow. */
export const RESERVED_IDS = new Set(["claude", "openclaw", "hermes", "overview", "goals", "journal", "memory", "settings"]);

/** Local endpoints (Ollama, LM Studio, …) don't need API keys. */
export function isLocalEndpoint(url: string): boolean {
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(url);
}

export async function readRegistry(): Promise<Registry> {
  try {
    const raw = JSON.parse(await fs.readFile(FILE, "utf8")) as Partial<Registry>;
    const reg: Registry = {
      llms: Array.isArray(raw.llms) ? raw.llms : [],
      commandAgents: Array.isArray(raw.commandAgents) ? raw.commandAgents : [],
      workspaces: Array.isArray(raw.workspaces) ? raw.workspaces : ["Default"],
    };
    if (!reg.workspaces.includes("Default")) reg.workspaces.unshift("Default");
    return reg;
  } catch {
    return structuredClone(EMPTY);
  }
}

export async function writeRegistry(reg: Registry): Promise<void> {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(reg, null, 2), "utf8");
}

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "agent"
  );
}

export function uniqueId(base: string, taken: Set<string>): string {
  let id = base;
  let n = 2;
  while (taken.has(id) || RESERVED_IDS.has(id)) id = `${base}-${n++}`;
  return id;
}

export async function findLlm(id: string): Promise<LlmConfig | undefined> {
  return (await readRegistry()).llms.find((l) => l.id === id);
}

export async function findCommandAgent(id: string): Promise<CommandAgentConfig | undefined> {
  return (await readRegistry()).commandAgents.find((a) => a.id === id);
}
