import fs from "fs/promises";
import path from "path";

/**
 * MCP servers for the Claude bridge. Stored directly in Claude Code's
 * --mcp-config format (data/mcp.json); the bridge passes the file along when
 * at least one server is registered.
 */
export const MCP_FILE = path.join(process.cwd(), "data", "mcp.json");

export const MCP_NAME_RE = /^[a-zA-Z0-9_-]{1,30}$/;

type StdioEntry = { command: string; args: string[] };
type HttpEntry = { type: "http"; url: string };

interface McpConfig {
  mcpServers: Record<string, StdioEntry | HttpEntry>;
}

export interface McpServerInfo {
  name: string;
  transport: "stdio" | "http";
  detail: string; // command line or url
}

async function load(): Promise<McpConfig> {
  try {
    const raw = JSON.parse(await fs.readFile(MCP_FILE, "utf8")) as McpConfig;
    return { mcpServers: raw.mcpServers ?? {} };
  } catch {
    return { mcpServers: {} };
  }
}

async function save(config: McpConfig): Promise<void> {
  await fs.mkdir(path.dirname(MCP_FILE), { recursive: true });
  await fs.writeFile(MCP_FILE, JSON.stringify(config, null, 2), "utf8");
}

export async function listMcpServers(): Promise<McpServerInfo[]> {
  const config = await load();
  return Object.entries(config.mcpServers).map(([name, entry]) => {
    if ("url" in entry) return { name, transport: "http", detail: entry.url };
    return { name, transport: "stdio", detail: [entry.command, ...entry.args].join(" ") };
  });
}

export async function addMcpServer(input: {
  name: string;
  transport: "stdio" | "http";
  commandLine?: string;
  url?: string;
}): Promise<void> {
  const config = await load();
  if (input.transport === "http") {
    config.mcpServers[input.name] = { type: "http", url: input.url ?? "" };
  } else {
    const parts = (input.commandLine ?? "").trim().split(/\s+/);
    config.mcpServers[input.name] = { command: parts[0], args: parts.slice(1) };
  }
  await save(config);
}

export async function removeMcpServer(name: string): Promise<void> {
  const config = await load();
  delete config.mcpServers[name];
  await save(config);
}

/** Extra CLI args for the Claude bridge — empty when no servers are registered. */
export async function mcpArgs(): Promise<string[]> {
  const config = await load();
  if (Object.keys(config.mcpServers).length === 0) return [];
  return ["--mcp-config", MCP_FILE];
}
