/**
 * Companion agent registry.
 *
 * Commands are defined SERVER-SIDE only — the browser can never send a raw
 * command, only an agent id + input text (piped to the process on stdin or
 * substituted for {input}). Override binaries/templates via env vars in
 * .env.local without touching code.
 */
export interface AgentDef {
  id: string;
  name: string;
  tagline: string;
  accent: "cyan" | "magenta" | "amber" | "lime" | "violet" | "rose";
  binary: string;
  /** {input} is replaced with the user's message; if absent, input is piped to stdin. */
  commandTemplate: string;
  versionArgs: string[];
}

export const AGENT_DEFS: AgentDef[] = [
  {
    id: "openclaw",
    name: "OpenClaw",
    tagline: "Personal assistant gateway",
    accent: "magenta",
    binary: process.env.OPENCLAW_BIN ?? "openclaw",
    commandTemplate:
      process.env.OPENCLAW_CMD ?? `${process.env.OPENCLAW_BIN ?? "openclaw"} agent --message {input}`,
    versionArgs: ["--version"],
  },
  {
    id: "hermes",
    name: "Hermes",
    tagline: "Nous Research agent",
    accent: "amber",
    binary: process.env.HERMES_BIN ?? "hermes",
    commandTemplate: process.env.HERMES_CMD ?? `${process.env.HERMES_BIN ?? "hermes"} -z {input}`,
    versionArgs: ["--version"],
  },
];

export function getAgentDef(id: string): AgentDef | undefined {
  return AGENT_DEFS.find((a) => a.id === id);
}
