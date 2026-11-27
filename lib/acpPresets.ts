/**
 * Known agents that speak the Agent Client Protocol, so a machine can switch one on without typing
 * a command (Fleet → Agents & fallback). Client-safe: pages import it for the list.
 *
 * A preset is only a suggestion of how to start the agent. What a machine actually runs is its own
 * data/acp-agents.json, changed only through its own local page (lib/acpAgents.ts): a request from
 * another machine names an agent by id and never carries a command (AGENTS.md rule 21's reasoning).
 *
 * Sign-in is always the agent's own, done by you in a terminal (`gemini`, `kimi`, …). Mission
 * Control never calls the protocol's `authenticate`: for Gemini one of the offered methods is a
 * billed API key, and the subscription rule says plans, not per-token billing.
 */
export interface AcpPreset {
  id: string;
  label: string;
  /** program on PATH */
  command: string;
  args: string[];
  /** what it runs on, completing "…with your ___" */
  runsOn: string;
  /** how to sign in, shown when a run reports it isn't */
  signIn: string;
  install: string;
}

export const ACP_PRESETS: AcpPreset[] = [
  { id: "gemini", label: "Gemini CLI", command: "gemini", args: ["--acp"], runsOn: "Google sign-in (Gemini plan)", signIn: "Open a terminal, run `gemini` and choose Log in with Google.", install: "npm install -g @google/gemini-cli" },
  { id: "kimi", label: "Kimi CLI", command: "kimi", args: ["--acp"], runsOn: "Kimi sign-in", signIn: "Open a terminal, run `kimi` and sign in (/login).", install: "uv tool install kimi-cli" },
  { id: "qwen", label: "Qwen Code", command: "qwen", args: ["--acp"], runsOn: "Qwen sign-in", signIn: "Open a terminal, run `qwen` and sign in.", install: "npm install -g @qwen-code/qwen-code" },
  { id: "goose", label: "Goose", command: "goose", args: ["acp"], runsOn: "Goose's configured provider", signIn: "Open a terminal and run `goose configure`.", install: "see block.github.io/goose" },
  { id: "opencode", label: "OpenCode", command: "opencode", args: ["acp"], runsOn: "OpenCode's configured provider", signIn: "Open a terminal and run `opencode auth login`.", install: "npm install -g opencode-ai" },
];

export const presetFor = (id: string) => ACP_PRESETS.find((p) => p.id === id);

/** What another machine learns about an agent here: its id and name, never its command. */
export interface AcpAgentInfo {
  id: string;
  label: string;
}
