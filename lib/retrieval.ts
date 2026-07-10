import { readMemory } from "./vault";
import { searchVault, type VaultPassage } from "./vaultSearch";

/**
 * Context gathering for agent calls: relevant shared-memory facts (keyword
 * retrieval over Memory.md) plus vault-wide RAG passages (lib/vaultSearch.ts).
 * Injecting only what's relevant keeps prompts lean as memory/vault grow.
 */
const STOP = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "is", "it", "for", "on", "with",
  "that", "this", "as", "are", "was", "be", "by", "at", "from", "your", "my", "you",
  "what", "which", "who", "how", "when", "why", "can", "will", "would", "should",
]);

function tokens(s: string): Set<string> {
  return new Set((s.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter((w) => !STOP.has(w)));
}

export async function retrieveMemoryFacts(query: string, maxFacts = 8): Promise<string> {
  const memory = await readMemory().catch(() => "");
  const lines = memory.split(/\r?\n/).filter((l) => l.trim().startsWith("- "));
  if (lines.length === 0) return "";
  if (lines.length <= maxFacts) return lines.join("\n");

  const q = tokens(query);
  const scored = lines.map((line, i) => {
    const t = tokens(line);
    let score = 0;
    for (const w of q) if (t.has(w)) score++;
    return { line, i, score };
  });

  const picked = new Set<number>();
  for (const s of [...scored].sort((a, b) => b.score - a.score || b.i - a.i)) {
    if (picked.size >= maxFacts) break;
    if (s.score > 0) picked.add(s.i);
  }
  for (let i = lines.length - 1; i >= 0 && picked.size < maxFacts; i--) picked.add(i);

  return lines.filter((_, i) => picked.has(i)).join("\n");
}

export interface AgentContext {
  facts: string;
  passages: VaultPassage[];
}

export const EMPTY_CONTEXT: AgentContext = { facts: "", passages: [] };

export async function gatherContext(query: string): Promise<AgentContext> {
  const [facts, passages] = await Promise.all([
    retrieveMemoryFacts(query),
    searchVault(query, 3).catch(() => [] as VaultPassage[]),
  ]);
  return { facts, passages };
}

/**
 * OS verbs: tags any agent can emit in a reply; the dashboard harvests and
 * executes them (see components/store.tsx).
 */
const VERB_HINT =
  `[OS verbs — include these tags anywhere in a reply and the dashboard executes them: ` +
  `<remember>fact</remember> saves a durable fact to shared memory (use sparingly) · ` +
  `<goal>task</goal> adds a checkbox goal · ` +
  `<journal>note</journal> appends to the user's journal · ` +
  `<mission>task</mission> launches a background Claude mission.]`;

function passagesText(passages: VaultPassage[]): string {
  return passages.map((p) => `(${p.file}${p.linked ? " — linked note" : ""}) ${p.text}`).join("\n---\n");
}

/** Preamble block for CLI-style agents (prepended to the transmitted prompt). */
export function memoryBlock(ctx: AgentContext): string {
  const parts: string[] = [];
  if (ctx.facts) parts.push(`[Shared memory — relevant facts from the user's agent network:]\n${ctx.facts}`);
  if (ctx.passages.length > 0) {
    parts.push(`[Vault context — possibly relevant excerpts from the user's notes:]\n${passagesText(ctx.passages)}`);
  }
  parts.push(VERB_HINT);
  return parts.join("\n") + "\n\n";
}

/** System-message variant for API LLMs. */
export function memorySystemBlock(ctx: AgentContext): string {
  const parts: string[] = [];
  if (ctx.facts) {
    parts.push(`SHARED MEMORY (relevant facts saved by you and the user's other AI agents):\n${ctx.facts}`);
  }
  if (ctx.passages.length > 0) {
    parts.push(`VAULT CONTEXT (possibly relevant excerpts from the user's notes):\n${passagesText(ctx.passages)}`);
  }
  parts.push(VERB_HINT);
  return parts.join("\n\n");
}
