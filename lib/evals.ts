import fs from "fs/promises";
import path from "path";
import { runAgentText } from "./runners";

/**
 * Eval harness: a saved suite of test prompts run against selected agents,
 * scored 0–10 by a judge (Claude) against per-case criteria. Turns "which
 * model is better" from vibes into trend lines.
 */
export interface EvalCase {
  id: string;
  name: string;
  prompt: string;
  criteria: string;
}

export interface EvalScore {
  agentId: string;
  caseId: string;
  score: number | null;
  notes: string;
  ms: number;
}

export interface EvalRun {
  id: string;
  ts: number;
  agentIds: string[];
  status: "running" | "done";
  scores: EvalScore[];
}

interface EvalData {
  cases: EvalCase[];
  runs: EvalRun[];
}

const FILE = path.join(process.cwd(), "data", "evals.json");

const DEFAULT_CASES: EvalCase[] = [
  {
    id: "reasoning",
    name: "Reasoning trap",
    prompt:
      "A notebook and a pen cost $12.50 together. The notebook costs $10 more than the pen. How much does the pen cost? Show your reasoning briefly, then give the answer.",
    criteria: "Correct answer is $1.25. Full marks for correct answer with sound reasoning; near-zero for $2.50.",
  },
  {
    id: "instruction",
    name: "Instruction following",
    prompt:
      "List exactly 4 uses for a paperclip. Format: numbered list, each item exactly 3 words, no other text before or after.",
    criteria: "Exactly 4 numbered items, each exactly 3 words, zero extra prose. Deduct per violation.",
  },
  {
    id: "concision",
    name: "Concise synthesis",
    prompt:
      "In one sentence of at most 25 words, explain why keyword search and embedding search complement each other in a retrieval system.",
    criteria: "One sentence, ≤25 words, technically correct (lexical precision vs semantic recall). Deduct for length violations or vagueness.",
  },
];

async function load(): Promise<EvalData> {
  try {
    const raw = JSON.parse(await fs.readFile(FILE, "utf8")) as Partial<EvalData>;
    return { cases: raw.cases?.length ? raw.cases : DEFAULT_CASES, runs: raw.runs ?? [] };
  } catch {
    return { cases: DEFAULT_CASES, runs: [] };
  }
}

async function save(data: EvalData): Promise<void> {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify({ cases: data.cases, runs: data.runs.slice(-50) }, null, 2), "utf8");
}

export async function getEvalData(): Promise<EvalData> {
  return load();
}

export async function addCase(input: { name: string; prompt: string; criteria: string }): Promise<void> {
  const data = await load();
  const id = input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "case";
  data.cases.push({
    id: data.cases.some((c) => c.id === id) ? `${id}-${data.cases.length}` : id,
    name: input.name.slice(0, 60),
    prompt: input.prompt.slice(0, 3000),
    criteria: input.criteria.slice(0, 1000),
  });
  await save(data);
}

export async function deleteCase(id: string): Promise<void> {
  const data = await load();
  data.cases = data.cases.filter((c) => c.id !== id);
  await save(data);
}

async function persistRun(run: EvalRun): Promise<void> {
  const data = await load();
  const i = data.runs.findIndex((r) => r.id === run.id);
  if (i >= 0) data.runs[i] = run;
  else data.runs.push(run);
  await save(data);
}

async function judgeAnswer(c: EvalCase, answer: string): Promise<{ score: number | null; notes: string }> {
  const prompt = [
    `You are a strict evaluator. Score this answer 0-10 against the criteria.`,
    ``,
    `TASK GIVEN TO THE MODEL:\n${c.prompt}`,
    ``,
    `SCORING CRITERIA:\n${c.criteria}`,
    ``,
    `MODEL'S ANSWER:\n${answer.slice(0, 4000)}`,
    ``,
    `Respond with ONLY a JSON object: {"score": <0-10>, "notes": "<one short sentence>"}`,
  ].join("\n");
  const r = await runAgentText("claude", prompt, { injectMemory: false });
  if (r.error) return { score: null, notes: `judge error: ${r.error.slice(0, 120)}` };
  try {
    const match = r.text.match(/\{[\s\S]*\}/);
    const json = JSON.parse(match?.[0] ?? "") as { score?: number; notes?: string };
    const score = typeof json.score === "number" ? Math.min(10, Math.max(0, json.score)) : null;
    return { score, notes: (json.notes ?? "").slice(0, 200) };
  } catch {
    return { score: null, notes: "judge returned unparseable output" };
  }
}

let seq = 0;

export async function startEvalRun(agentIds: string[], caseIds?: string[]): Promise<EvalRun> {
  const data = await load();
  const cases = caseIds?.length ? data.cases.filter((c) => caseIds.includes(c.id)) : data.cases;
  const run: EvalRun = {
    id: `ev-${Date.now().toString(36)}${seq++}`,
    ts: Date.now(),
    agentIds,
    status: "running",
    scores: [],
  };
  await persistRun(run);

  void (async () => {
    for (const agentId of agentIds) {
      for (const c of cases) {
        const r = await runAgentText(agentId, c.prompt, { injectMemory: false });
        const verdict = r.error
          ? { score: 0, notes: `agent errored: ${r.error.slice(0, 120)}` }
          : await judgeAnswer(c, r.text);
        run.scores.push({ agentId, caseId: c.id, score: verdict.score, notes: verdict.notes, ms: r.ms });
        await persistRun(run);
      }
    }
    run.status = "done";
    await persistRun(run);
  })();

  return run;
}
