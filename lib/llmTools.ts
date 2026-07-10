import fs from "fs/promises";
import path from "path";
import { searchVault } from "./vaultSearch";
import { appendMemory, readGoals, writeGoals, appendJournalEntry, vaultInfo } from "./vault";
import { createApproval } from "./approvals";

/**
 * Native function tools for API LLMs (OpenAI tool-calling format). These are
 * the OS verbs plus read access — everything is local vault/OS surface, and
 * the only spending action (request_mission) goes through the approval gate.
 */
export const TOOL_DEFS = [
  {
    type: "function",
    function: {
      name: "search_vault",
      description:
        "Search the user's Obsidian vault (journals, chat logs, mission archives, notes) and return the most relevant passages.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "what to look for" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_note",
      description: "Read a note from the vault by its vault-relative path, e.g. 'Agentic OS/Home.md'.",
      parameters: {
        type: "object",
        properties: { file: { type: "string", description: "vault-relative path ending in .md" } },
        required: ["file"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_memory",
      description: "Save a durable fact to the shared memory that all of the user's AI agents read. Use sparingly.",
      parameters: {
        type: "object",
        properties: { fact: { type: "string" } },
        required: ["fact"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_goal",
      description: "Add a checkbox goal to the user's Goals list.",
      parameters: {
        type: "object",
        properties: { task: { type: "string" } },
        required: ["task"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_goals",
      description: "List the user's current goals with their done/open status.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "append_journal",
      description: "Append a timestamped note to the user's journal for today.",
      parameters: {
        type: "object",
        properties: { note: { type: "string" } },
        required: ["note"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "request_mission",
      description:
        "Request a background Claude mission for a task. The user must approve it (dashboard or Telegram) before it runs.",
      parameters: {
        type: "object",
        properties: { task: { type: "string" } },
        required: ["task"],
      },
    },
  },
];

export async function executeTool(name: string, argsJson: string, source: string): Promise<string> {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(argsJson || "{}") as Record<string, unknown>;
  } catch {
    return "error: tool arguments were not valid JSON";
  }

  try {
    switch (name) {
      case "search_vault": {
        const results = await searchVault(String(args.query ?? ""), 4);
        return results.length > 0
          ? results.map((p) => `(${p.file}) ${p.text}`).join("\n---\n").slice(0, 4000)
          : "no matches in the vault";
      }
      case "read_note": {
        const rel = String(args.file ?? "");
        if (!rel.endsWith(".md")) return "error: only .md notes can be read";
        const { root } = vaultInfo();
        const target = path.normalize(path.join(root, rel));
        if (!target.startsWith(path.normalize(root))) return "error: path escapes the vault";
        const content = await fs.readFile(target, "utf8").catch(() => null);
        return content === null ? "error: note not found" : content.slice(0, 4000);
      }
      case "save_memory": {
        const fact = String(args.fact ?? "").trim();
        if (!fact) return "error: fact is empty";
        await appendMemory(fact.slice(0, 2000), source);
        return "saved to shared memory";
      }
      case "add_goal": {
        const task = String(args.task ?? "").trim();
        if (!task) return "error: task is empty";
        const tasks = await readGoals();
        await writeGoals([...tasks, { text: task.slice(0, 500), done: false }]);
        return "goal added";
      }
      case "list_goals": {
        const tasks = await readGoals();
        return tasks.length > 0
          ? tasks.map((t) => `${t.done ? "[x]" : "[ ]"} ${t.text}`).join("\n")
          : "no goals yet";
      }
      case "append_journal": {
        const note = String(args.note ?? "").trim();
        if (!note) return "error: note is empty";
        await appendJournalEntry(note.slice(0, 5000), source);
        return "journal updated";
      }
      case "request_mission": {
        const task = String(args.task ?? "").trim();
        if (!task) return "error: task is empty";
        const approval = await createApproval({ payload: task, source });
        return `approval requested (${approval.id}) — the user must approve before it runs`;
      }
      default:
        return `error: unknown tool ${name}`;
    }
  } catch (e) {
    return `error: ${(e as Error).message}`;
  }
}
