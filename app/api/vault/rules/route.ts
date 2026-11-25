import { ensureRulesNote, readRules, vaultAvailable, vaultInfo, RULES_MAX_CHARS } from "@/lib/vault";
import path from "path";

export const dynamic = "force-dynamic";

/** The rules every agent is being given right now, and where they come from. */
export async function GET() {
  const rules = await readRules();
  return Response.json({
    ...rules,
    chars: rules.text.length,
    maxChars: RULES_MAX_CHARS,
    note: path.join(vaultInfo().base, "Rules.md"),
  });
}

/** Create Agentic OS/Rules.md from the built-in rules if it is missing. Never overwrites. */
export async function POST() {
  if (!(await vaultAvailable())) return Response.json({ error: "vault not reachable" }, { status: 503 });
  const created = await ensureRulesNote();
  return Response.json({ ok: true, created, ...(await readRules()) });
}
