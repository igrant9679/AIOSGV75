import { spawn } from "child_process";
import os from "os";
import { AGENT_DEFS } from "./agents-config";
import { readRegistry, type LlmConfig } from "./registry";
import { gatherContext, memoryBlock, memorySystemBlock, EMPTY_CONTEXT } from "./retrieval";
import { recordUsage } from "./usage";

/**
 * Non-streaming, promise-based agent runners for server-side orchestration
 * (missions). Each returns the agent's final text; the SSE chat routes remain
 * the streaming path for interactive use.
 */
export interface RunResult {
  text: string;
  ms: number;
  error?: string;
  costUsd?: number;
  tokensIn?: number;
  tokensOut?: number;
}

const CLI_TIMEOUT_MS = 300_000;
const LLM_TIMEOUT_MS = 180_000;

function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key === "ANTHROPIC_API_KEY") continue;
    if (key.startsWith("CLAUDE_") || key.startsWith("ANTHROPIC_") || key === "CLAUDECODE") delete env[key];
  }
  return env;
}

export function runClaudeText(prompt: string): Promise<RunResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn("claude", ["-p", "--output-format", "json"], {
      shell: true,
      cwd: os.homedir(),
      env: cleanEnv(),
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve({ text: out, ms: Date.now() - started, error: "timed out" });
    }, CLI_TIMEOUT_MS);

    child.stdout.on("data", (c: Buffer) => (out += c.toString("utf8")));
    child.stderr.on("data", (c: Buffer) => (err = (err + c.toString("utf8")).slice(-1500)));
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ text: "", ms: Date.now() - started, error: e.message });
    });
    child.on("close", () => {
      clearTimeout(timer);
      try {
        const json = JSON.parse(out) as {
          result?: string;
          is_error?: boolean;
          total_cost_usd?: number;
          usage?: { input_tokens?: number; output_tokens?: number };
        };
        resolve({
          text: json.result ?? "",
          ms: Date.now() - started,
          error: json.is_error ? (json.result ?? "claude run failed") : undefined,
          costUsd: json.total_cost_usd,
          tokensIn: json.usage?.input_tokens,
          tokensOut: json.usage?.output_tokens,
        });
      } catch {
        resolve({ text: out.trim(), ms: Date.now() - started, error: out.trim() ? undefined : err || "no output" });
      }
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

export function runCommandText(def: { commandTemplate: string }, input: string): Promise<RunResult> {
  const started = Date.now();
  const useStdin = !def.commandTemplate.includes("{input}");
  const command = useStdin ? def.commandTemplate : def.commandTemplate.replace("{input}", JSON.stringify(input));

  return new Promise((resolve) => {
    const child = spawn(command, [], { cwd: os.homedir(), shell: true, env: cleanEnv() });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve({ text: out.trim(), ms: Date.now() - started, error: "timed out" });
    }, CLI_TIMEOUT_MS);

    child.stdout.on("data", (c: Buffer) => (out += c.toString("utf8")));
    child.stderr.on("data", (c: Buffer) => (err = (err + c.toString("utf8")).slice(-1500)));
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ text: "", ms: Date.now() - started, error: e.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const text = out.trim();
      resolve({
        text,
        ms: Date.now() - started,
        error: code !== 0 && !text ? `exit ${code}: ${err.trim().slice(0, 300)}` : undefined,
      });
    });
    if (useStdin) child.stdin.write(input + "\n");
    child.stdin.end();
  });
}

export async function runLlmText(llm: LlmConfig, prompt: string, system: string): Promise<RunResult> {
  const started = Date.now();
  if (!llm.apiKey) return { text: "", ms: 0, error: `no API key saved for ${llm.name}` };
  try {
    const res = await fetch(`${llm.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${llm.apiKey}` },
      body: JSON.stringify({
        model: llm.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
        stream: false,
      }),
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      return { text: "", ms: Date.now() - started, error: `${llm.name} API ${res.status}: ${detail}` };
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    return {
      text: json.choices?.[0]?.message?.content?.trim() ?? "",
      ms: Date.now() - started,
      tokensIn: json.usage?.prompt_tokens,
      tokensOut: json.usage?.completion_tokens,
    };
  } catch (e) {
    return { text: "", ms: Date.now() - started, error: (e as Error).message };
  }
}

/** Run any registered agent by id, with retrieved shared memory injected. */
export async function runAgentText(
  agentId: string,
  prompt: string,
  opts: { injectMemory?: boolean } = {},
): Promise<RunResult> {
  const inject = opts.injectMemory !== false;
  const ctx = inject ? await gatherContext(prompt) : EMPTY_CONTEXT;

  let result: RunResult | null = null;
  if (agentId === "claude") {
    result = await runClaudeText((inject ? memoryBlock(ctx) : "") + prompt);
  } else {
    const reg = await readRegistry();
    const llm = reg.llms.find((l) => l.id === agentId);
    if (llm) {
      const system = `${llm.systemPrompt?.trim() || `You are ${llm.name}, an AI agent on the user's Mission Control dashboard.`}\n\n${memorySystemBlock(ctx)}`;
      result = await runLlmText(llm, prompt, system);
    } else {
      const def = AGENT_DEFS.find((d) => d.id === agentId) ?? reg.commandAgents.find((a) => a.id === agentId);
      if (def) result = await runCommandText(def, (inject ? memoryBlock(ctx) : "") + prompt);
    }
  }

  if (!result) return { text: "", ms: 0, error: `unknown agent: ${agentId}` };
  void recordUsage({
    ts: Date.now(),
    agent: agentId,
    kind: "mission",
    ms: result.ms,
    costUsd: result.costUsd,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    ok: !result.error,
  }).catch(() => {});
  return result;
}
