import { spawn } from "child_process";
import { existsSync } from "fs";
import os from "os";
import { vaultInfo } from "./vault";
import { productName } from "./netSettings";
import { AGENT_DEFS } from "./agents-config";
import { readRegistry, isLocalEndpoint, type LlmConfig } from "./registry";
import { gatherContext, memoryBlock, memorySystemBlock, EMPTY_CONTEXT } from "./retrieval";
import { recordUsage } from "./usage";
import path from "path";
import fsp from "fs/promises";
import { needsWeb, pickHermesModel } from "./nousModels";
import { hermesToolsets } from "./sessionTools";

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
  /** set when the "auto" router delegated this run */
  routedTo?: string;
  routeReason?: string;
}

const CLI_TIMEOUT_MS = 300_000;
const LLM_TIMEOUT_MS = 180_000;

/** The env Mission Control runs agent CLIs with: no inherited Claude session vars, so they use their own login. */
/**
 * Variables that make a signed-in CLI bill an API account per token instead of
 * using its subscription. `claude -p` picks up ANTHROPIC_API_KEY without asking;
 * the others do the same for Codex, the Gemini CLI and Kimi's CLI. They often
 * sit in .env.local for a different reason (Studio's image and voice
 * providers read OPENAI_API_KEY / GEMINI_API_KEY there), and everything in
 * .env.local is in this process's environment.
 */
export const API_KEY_VARS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "OPENAI_API_KEY",
  "CODEX_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "MOONSHOT_API_KEY",
  "KIMI_API_KEY",
];

/**
 * Subscription only, the default: agent CLIs never see a provider API key, so
 * they can only run on the login they were signed in with. A machine that
 * really has to run a CLI on an API key opts out with MC_ALLOW_API_KEYS=1 in
 * .env.local. Studio and API LLMs are unaffected either way: they read their
 * keys in this process, not in a child.
 */
export function subscriptionOnly(): boolean {
  return process.env.MC_ALLOW_API_KEYS !== "1";
}

export function cleanEnv(headless = true): NodeJS.ProcessEnv {
  const env = { ...process.env };
  const strict = subscriptionOnly();
  for (const key of Object.keys(env)) {
    if (key === "ANTHROPIC_API_KEY" && !strict) continue;
    if (key.startsWith("CLAUDE_") || key.startsWith("ANTHROPIC_") || key === "CLAUDECODE") delete env[key];
  }
  if (strict) for (const key of API_KEY_VARS) delete env[key];
  // Mission Control's own background runs: the session-alert hook (scripts/mc-hook.mjs) ignores them
  if (headless) env.MC_HEADLESS = "1";
  else delete env.MC_HEADLESS;
  return env;
}

/**
 * Folder agent CLIs start in: the vault when this machine has it, else the home folder.
 * Prompts name notes by vault-relative paths ("Workspaces/.../Project Overview.md"),
 * and a headless `claude -p` can only read files under the folder it starts in - from
 * the home folder every scheduled mission reported "the vault isn't present".
 */
export function agentCwd(): string {
  const root = vaultInfo().root;
  try { if (root && existsSync(root)) return root; } catch { /* fall through */ }
  return os.homedir();
}

/**
 * Stop a child AND what it started. With `shell: true` the child is cmd.exe, so
 * child.kill() ends the shell and leaves the real program (claude.exe) running
 * for as long as it likes — a timed-out review was found still alive nine
 * minutes later.
 */
function killTree(pid: number | undefined): void {
  if (!pid) return;
  try {
    if (process.platform === "win32") spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    else process.kill(pid, "SIGTERM");
  } catch {
    /* already gone */
  }
}

/**
 * Tools a read-only run may not use. Not about trust: a headless run that asks
 * for permission to run a command WAITS up to ten minutes for someone to answer
 * it in the app (lib/permissions.ts), which is longer than a run is given here.
 * A reviewer that wanted to "just run the tests" sat there until it timed out.
 */
const CLAUDE_READ_ONLY = ["--disallowedTools", "Bash,PowerShell,Edit,Write,MultiEdit,NotebookEdit"];

/** extraArgs: e.g. ["--model", "haiku", "--no-session-persistence"] for light housekeeping runs. */
export function runClaudeText(prompt: string, extraArgs: string[] = [], cwd?: string): Promise<RunResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn("claude", ["-p", "--output-format", "json", ...extraArgs], {
      shell: true,
      cwd: cwd ?? agentCwd(),
      env: cleanEnv(),
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      killTree(child.pid);
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
    const child = spawn(command, [], { cwd: agentCwd(), shell: true, env: cleanEnv() });
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
  if (!llm.apiKey && !isLocalEndpoint(llm.baseUrl)) {
    return { text: "", ms: 0, error: `no API key saved for ${llm.name}` };
  }
  try {
    const res = await fetch(`${llm.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(llm.apiKey ? { Authorization: `Bearer ${llm.apiKey}` } : {}),
      },
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

/**
 * Hermes for Auto: one question, on the cheapest Nous model that fits, with only the
 * answer-level toolsets (no terminal, no files). The registered Hermes agent
 * (`hermes -z`) is a different thing: Hermes's own default model with every
 * tool auto-approved, which is the owner's choice when they talk to Hermes directly.
 */
async function runHermesFree(prompt: string): Promise<RunResult> {
  const started = Date.now();
  const web = needsWeb(prompt);
  const choice = await pickHermesModel({ needsWeb: web });
  const once = (model?: string) =>
    new Promise<RunResult>((resolve) => {
      const args = ["chat", "-q", prompt, "-Q", "-t", hermesToolsets("answer", web)];
      if (model) args.push("-m", model);
      // shell:false — the prompt is an argument, and through cmd.exe a newline would end the command
      const child = spawn(process.env.HERMES_BIN || "hermes", args, { cwd: agentCwd(), shell: false, env: cleanEnv(), windowsHide: true });
      let out = "";
      let err = "";
      const timer = setTimeout(() => {
        child.kill();
        resolve({ text: "", ms: Date.now() - started, error: "timed out" });
      }, CLI_TIMEOUT_MS);
      child.stdout.on("data", (c: Buffer) => (out += c.toString("utf8")));
      child.stderr.on("data", (c: Buffer) => (err = (err + c.toString("utf8")).slice(-1500)));
      child.on("error", (e) => {
        clearTimeout(timer);
        resolve({ text: "", ms: Date.now() - started, error: e.message });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        const plain = (t: string) => t.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").replace(/\r\n/g, "\n");
        const text = plain(out).trim();
        // Hermes prints a failure where the answer would go and exits non-zero
        if (code !== 0 || !text) resolve({ text: "", ms: Date.now() - started, error: (text || plain(err).replace(/session_id:[^\n]*/g, "").trim() || `hermes exited with code ${code}`).slice(-400) });
        else resolve({ text, ms: Date.now() - started, costUsd: choice.free ? 0 : undefined });
      });
    });
  let r = await once(choice.model);
  // free tiers are rate-limited: one retry on the next-cheapest model before Auto escalates
  if (r.error && choice.fallbacks[0]) r = await once(choice.fallbacks[0]);
  return r;
}

/** Codex for Auto: `codex exec` on the ChatGPT sign-in, read-only (its default sandbox), answer to a file. */
async function runCodexCli(prompt: string, cwd?: string): Promise<RunResult> {
  const started = Date.now();
  const outFile = path.join(os.tmpdir(), `mc-auto-codex-${process.pid}-${Date.now().toString(36)}.txt`);
  return new Promise<RunResult>((resolve) => {
    const child = spawn("codex", ["exec", "-", "--skip-git-repo-check", "-o", `"${outFile}"`], { cwd: cwd ?? agentCwd(), shell: true, env: cleanEnv(), windowsHide: true });
    let err = "";
    const finish = async (error?: string) => {
      const text = (await fsp.readFile(outFile, "utf8").catch(() => "")).trim();
      await fsp.rm(outFile, { force: true }).catch(() => {});
      resolve({ text, ms: Date.now() - started, error: text ? undefined : error || "no output" });
    };
    const timer = setTimeout(() => {
      killTree(child.pid);
      void finish("timed out");
    }, CLI_TIMEOUT_MS);
    child.stderr.on("data", (c: Buffer) => (err = (err + c.toString("utf8")).slice(-1500)));
    child.stdout.on("data", () => {});
    child.on("error", (e) => {
      clearTimeout(timer);
      void finish(e.message);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      void finish(code === 0 ? undefined : err.trim().slice(-400) || `codex exited with code ${code}`);
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

/** Run any registered agent by id, with retrieved shared memory injected. */
export async function runAgentText(
  agentId: string,
  prompt: string,
  opts: {
    injectMemory?: boolean;
    /** Claude and Codex: start in this folder instead of the vault, so the agent can read a project's real files. */
    cwd?: string;
    /** Claude: may read, may not run commands or change files — and therefore can never stall on a permission prompt. */
    readOnly?: boolean;
  } = {},
): Promise<RunResult> {
  // "auto" is virtual: route to a real agent. If the pick errors, climb the cost ladder one
  // rung at a time — another free worker (a local model when Hermes's free tier is rate-limited
  // or the machine is offline), then a subscription tool, then Claude — instead of jumping
  // straight to the most expensive one. Models added by API key are only in the pool if opted in.
  if (agentId === "auto") {
    const { routeTask, routablePool } = await import("./router");
    const decision = await routeTask(prompt);
    let r = await runAgentText(decision.agentId, prompt, opts);
    let reason = decision.reason;
    let routedTo = decision.agentId;
    if (r.error) {
      const bands = ["free", "subscription", "premium", "metered"];
      const { pool } = await routablePool();
      const picked = pool.find((c) => c.id === decision.agentId);
      const from = picked ? bands.indexOf(picked.band) : 0;
      const ladder = pool
        .filter((c) => c.id !== decision.agentId && bands.indexOf(c.band) >= from)
        .sort((a, b) => bands.indexOf(a.band) - bands.indexOf(b.band) || a.costRank - b.costRank);
      // Claude is the last resort even when the health filter has benched it
      if (!ladder.some((c) => c.id === "claude") && decision.agentId !== "claude") ladder.push({ id: "claude", name: "Claude", band: "premium", costRank: 9, winRate: null, battles: 0, health: null });
      let failed = decision.agentName;
      for (const next of ladder.slice(0, 3)) {
        r = await runAgentText(next.id, prompt, opts);
        reason += ` · ${failed} errored → ${next.name}`;
        routedTo = next.id;
        if (!r.error) break;
        failed = next.name;
      }
    }
    return { ...r, routedTo, routeReason: reason };
  }

  const inject = opts.injectMemory !== false;
  const ctx = inject ? await gatherContext(prompt) : EMPTY_CONTEXT;

  let result: RunResult | null = null;
  if (agentId === "claude") {
    result = await runClaudeText((inject ? memoryBlock(ctx) : "") + prompt, opts.readOnly ? CLAUDE_READ_ONLY : [], opts.cwd);
  } else if (agentId === "hermes-free") {
    result = await runHermesFree((inject ? memoryBlock(ctx) : "") + prompt);
  } else if (agentId === "codex-cli") {
    // codex exec is already read-only unless told otherwise, and never stops to ask
    result = await runCodexCli((inject ? memoryBlock(ctx) : "") + prompt, opts.cwd);
  } else {
    const reg = await readRegistry();
    const llm = reg.llms.find((l) => l.id === agentId);
    if (llm) {
      // a local model reads the shared brain but is not invited to write to it (lib/llmTools.ts WRITE_TOOLS)
      const system = `${llm.systemPrompt?.trim() || `You are ${llm.name}, an AI agent on the user's ${productName()} dashboard.`}\n\n${memorySystemBlock(ctx, { verbs: !isLocalEndpoint(llm.baseUrl) })}`;
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
