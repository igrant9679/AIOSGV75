import type { ConsoleEntry } from "./types";

const AGENT_LABELS: Record<string, string> = {
  claude: "Claude",
  openclaw: "OpenClaw",
  hermes: "Hermes",
};

/** Display name for an agent id — also the filename of its Obsidian hub page. */
export function agentDisplayName(id: string): string {
  return AGENT_LABELS[id] ?? id.charAt(0).toUpperCase() + id.slice(1);
}

/** Wikilink to an agent's hub page (Agentic OS/Agents/<Name>.md). */
export function agentWikilink(id: string): string {
  const name = agentDisplayName(id);
  return `[[Agentic OS/Agents/${name}|${name}]]`;
}

/** Render chat entries as Obsidian-friendly markdown for the daily chat log. */
export function renderChatMarkdown(chatId: string, entries: ConsoleEntry[]): string {
  const agent = agentDisplayName(chatId);
  const stamp = new Date(entries[0]?.ts ?? Date.now()).toLocaleTimeString("en-US", { hour12: false });
  const lines: string[] = [`### ${stamp} · ${agentWikilink(chatId)}`, ""];

  for (const e of entries) {
    const text = e.text.trim();
    if (!text) continue;
    switch (e.role) {
      case "user":
        lines.push(`**You:**`, text, "");
        break;
      case "assistant":
        lines.push(`**${agent}:**`, text, "");
        break;
      case "tool":
        lines.push(...text.split("\n").map((l) => `> \`tool\` ${l}`), "");
        break;
      case "error":
        lines.push(...text.split("\n").map((l) => `> ⚠️ ${l}`), "");
        break;
      case "system":
        lines.push(`> _${text}_`, "");
        break;
    }
  }
  return lines.join("\n");
}
