import { spawn } from "child_process";
import fsp from "fs/promises";
import path from "path";
import { cleanEnv } from "./runners";
import { insideFolder, looksSignedOut, permissionChoice, type AcpAccess } from "./acpPolicy";
import { resolveAcpCommand, type AcpAgent } from "./acpAgents";
import type { AcpEntry } from "./acpStore";
import { presetFor } from "./acpPresets";

/**
 * One prompt turn with an agent that speaks the Agent Client Protocol: JSON-RPC 2.0, one message
 * per line, over the agent's stdin/stdout (agentclientprotocol.com). Verified against Gemini CLI
 * 0.71.1 (`gemini --acp`): protocolVersion 1, loadSession true.
 *
 *   initialize          protocol 1; we offer file read/write (checked, below), no terminal
 *   session/load        continue a session, when the agent can (it replays the history to us,
 *                       which we ignore: our own record already has it)
 *   session/new         otherwise, in the session's folder, with no MCP servers
 *   session/prompt      the message; the turn ends when this returns a stopReason
 *
 * While the turn runs the agent sends session/update notifications (reply text in chunks, tool
 * calls and their progress), and may ask us things:
 *
 *   session/request_permission  answered by lib/acpPolicy.ts from the run's access level
 *   fs/read_text_file           only inside the session's folder
 *   fs/write_text_file          only inside the folder, and only with "Can edit files"
 *   anything else               "method not found"
 *
 * The agent is started with cleanEnv() (no API keys: subscriptions only, AGENTS.md rule 8), and
 * never asked to `authenticate`: signing in is yours, in the agent's own terminal.
 */

export interface AcpTurnInput {
  agent: AcpAgent;
  cwd: string;
  prompt: string;
  access: AcpAccess;
  /** continue this agent session (session/load); unset = a new session */
  sessionId?: string;
  timeoutMs: number;
  onSpawn?: (pid?: number) => void;
  /** reply so far and tool steps, about once a second */
  onProgress?: (text: string, steps: string[]) => void;
  /** the agent's session id, as soon as it is known */
  onSession?: (sessionId: string) => void;
}

export interface AcpTurnResult {
  sessionId?: string;
  /** false when a session/load was asked for and the agent couldn't (a new session was not started) */
  loaded?: boolean;
  text: string;
  stopReason?: string;
  error?: string;
  timedOut: boolean;
  /** what happened in this turn, for the session record */
  entries: AcpEntry[];
  steps: string[];
  refused: string[];
}

type Msg = { jsonrpc?: string; id?: number | string; method?: string; params?: Record<string, unknown>; result?: unknown; error?: { code?: number; message?: string } };

const PROTOCOL = 1;
const q = (a: string) => (/[\s"&|<>^()]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);

export function runAcpTurn(input: AcpTurnInput): Promise<AcpTurnResult> {
  return new Promise((resolve) => {
    const { agent, cwd, access } = input;
    // a bare program name needs the shell on Windows (npm installs `gemini.cmd`); arguments come from
    // this machine's own file and the prompt goes over stdin, never on the command line
    // npm installs a .cmd launcher, which needs the shell; arguments are this machine's own and the prompt goes over stdin
    const command = resolveAcpCommand(agent.command) ?? agent.command;
    const shell = process.platform === "win32" && !/\.exe$/i.test(command);
    const env = cleanEnv();
    // Gemini routes through a (billed) Google Cloud project when these are set; a plan sign-in must not
    if (process.env.MC_ALLOW_API_KEYS !== "1") for (const k of ["GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_PROJECT_ID", "GOOGLE_GENAI_USE_VERTEXAI"]) delete env[k];
    const child = spawn(shell ? q(command) : command, shell ? agent.args.map(q) : agent.args, { cwd, shell, env, windowsHide: true, detached: process.platform !== "win32" });
    input.onSpawn?.(child.pid);

    let nextId = 1;
    const waiting = new Map<number, (m: Msg) => void>();
    const entries: AcpEntry[] = [];
    const steps: string[] = [];
    const refused: string[] = [];
    const tools = new Map<string, Extract<AcpEntry, { kind: "tool" }>>();
    let text = "";
    let sessionId = input.sessionId;
    let loading = false; // during session/load the agent replays old messages: not this turn's
    let stderr = "";
    let finished = false;
    let buf = "";

    const finish = (r: Partial<AcpTurnResult>) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      clearInterval(ticker);
      if (text.trim()) entries.push({ kind: "assistant", ts: Date.now(), text: text.trim() });
      try {
        child.stdin.end();
      } catch {
        /* closed */
      }
      killSoon(child.pid);
      resolve({ sessionId, text: text.trim(), entries, steps, refused, timedOut: false, ...r });
    };
    const timer = setTimeout(() => finish({ timedOut: true, error: `Stopped after ${Math.round(input.timeoutMs / 60_000)} minutes.` }), input.timeoutMs);
    let lastSent = "";
    const ticker = setInterval(() => {
      const sig = `${text.length}:${steps.length}`;
      if (sig !== lastSent) {
        lastSent = sig;
        input.onProgress?.(text, steps);
      }
    }, 1000);

    const write = (m: Msg) => {
      try {
        child.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\n");
      } catch {
        /* the agent has gone; close handles it */
      }
    };
    const call = (method: string, params: Record<string, unknown>) =>
      new Promise<Msg>((res) => {
        const id = nextId++;
        waiting.set(id, res);
        write({ id, method, params });
      });

    const onUpdate = (u: Record<string, unknown>) => {
      if (loading) return;
      const kind = String(u.sessionUpdate ?? "");
      if (kind === "agent_message_chunk") {
        const c = u.content as { type?: string; text?: string } | undefined;
        if (c?.type === "text" && typeof c.text === "string") text += c.text;
      } else if (kind === "tool_call" || kind === "tool_call_update") {
        const id = String(u.toolCallId ?? "");
        if (!id) return;
        let t = tools.get(id);
        if (!t) {
          const title = String(u.title ?? u.name ?? "tool").slice(0, 160);
          t = { kind: "tool", ts: Date.now(), id, name: String(u.kind ?? "tool"), summary: title, input: u.rawInput ? JSON.stringify(u.rawInput).slice(0, 4000) : "" };
          tools.set(id, t);
          // the reply written so far belongs before this tool call
          if (text.trim()) {
            entries.push({ kind: "assistant", ts: Date.now(), text: text.trim() });
            text = "";
          }
          entries.push(t);
          steps.push(title);
        } else if (typeof u.title === "string" && u.title) t.summary = u.title.slice(0, 160);
        if (u.status === "failed") t.isError = true;
        const out = contentText(u.content) || (u.rawOutput ? JSON.stringify(u.rawOutput) : "");
        if (out) t.output = out.slice(0, 6000);
      }
    };

    const answerAgent = async (m: Msg) => {
      const p = m.params ?? {};
      try {
        if (m.method === "session/request_permission") {
          const tc = (p.toolCall ?? {}) as { kind?: string; title?: string };
          const { allowed, outcome } = permissionChoice(tc.kind, access, (p.options ?? []) as never);
          if (!allowed) refused.push(`${tc.title ?? tc.kind ?? "a tool call"} (${tc.kind ?? "unknown kind"})`);
          write({ id: m.id, result: { outcome } });
          return;
        }
        if (m.method === "fs/read_text_file") {
          const file = String(p.path ?? "");
          if (!insideFolder(cwd, file)) throw new Error("Only files inside the session's folder can be read.");
          const all = await fsp.readFile(path.resolve(cwd, file), "utf8");
          const line = typeof p.line === "number" && p.line > 0 ? p.line : 1;
          const limit = typeof p.limit === "number" && p.limit > 0 ? p.limit : undefined;
          const lines = all.split("\n");
          write({ id: m.id, result: { content: line === 1 && !limit ? all : lines.slice(line - 1, limit ? line - 1 + limit : undefined).join("\n") } });
          return;
        }
        if (m.method === "fs/write_text_file") {
          const file = String(p.path ?? "");
          if (access !== "edit") {
            refused.push(`write ${path.basename(file)}`);
            throw new Error("This run may not change files (Answer only).");
          }
          if (!insideFolder(cwd, file)) throw new Error("Only files inside the session's folder can be written.");
          await fsp.mkdir(path.dirname(path.resolve(cwd, file)), { recursive: true });
          await fsp.writeFile(path.resolve(cwd, file), String(p.content ?? ""), "utf8");
          write({ id: m.id, result: null });
          return;
        }
        write({ id: m.id, error: { code: -32601, message: `Method not found: ${m.method}` } });
      } catch (e) {
        write({ id: m.id, error: { code: -32000, message: (e as Error).message } });
      }
    };

    child.stdout.on("data", (c: Buffer) => {
      buf += c.toString("utf8");
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith("{")) continue;
        let m: Msg;
        try {
          m = JSON.parse(line);
        } catch {
          continue;
        }
        if (m.method && m.id !== undefined) void answerAgent(m); // a request from the agent
        else if (m.method === "session/update") onUpdate((m.params?.update ?? {}) as Record<string, unknown>);
        else if (typeof m.id === "number" && waiting.has(m.id)) {
          const res = waiting.get(m.id)!;
          waiting.delete(m.id);
          res(m);
        }
      }
    });
    child.stderr.on("data", (c: Buffer) => {
      stderr = (stderr + c.toString("utf8")).slice(-3000);
    });
    child.on("error", (e) => finish({ error: `${agent.label} couldn't start: ${e.message}` }));
    child.on("close", (code) => {
      if (!finished) finish({ error: `${agent.label} stopped (exit code ${code ?? "?"}) before finishing.${stderr.trim() ? ` ${stderr.trim().slice(-400)}` : ""}` });
    });

    const fail = (step: string, e?: { message?: string }) => {
      const msg = (e?.message || stderr.trim().slice(-400) || "no reason given").replace(/\.\s*$/, "");
      const hint = looksSignedOut(msg) ? ` ${agent.label} isn't signed in on this machine. ${presetFor(agent.id)?.signIn ?? "Sign in to it in a terminal."}` : "";
      finish({ error: `${agent.label}: ${step} failed: ${msg}.${hint}` });
    };

    void (async () => {
      const init = await call("initialize", {
        protocolVersion: PROTOCOL,
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false },
        clientInfo: { name: "mission-control", version: "1" },
      });
      if (init.error) return fail("starting", init.error);
      const caps = ((init.result ?? {}) as { agentCapabilities?: { loadSession?: boolean } }).agentCapabilities ?? {};
      if (input.sessionId) {
        if (!caps.loadSession) return finish({ loaded: false, error: `${agent.label} can't continue an earlier session.` });
        loading = true;
        const r = await call("session/load", { sessionId: input.sessionId, cwd, mcpServers: [] });
        loading = false;
        if (r.error) return finish({ loaded: false, error: `${agent.label} couldn't reopen the session: ${r.error.message ?? "unknown"}` });
      } else {
        const r = await call("session/new", { cwd, mcpServers: [] });
        if (r.error) return fail("starting a session", r.error);
        const sid = (r.result as { sessionId?: string } | undefined)?.sessionId;
        if (!sid || !/^[\w.-]{1,160}$/.test(sid)) return fail("starting a session", { message: "the agent gave no usable session id" });
        sessionId = sid;
      }
      input.onSession?.(sessionId!);
      entries.push({ kind: "user", ts: Date.now(), text: input.prompt });
      const r = await call("session/prompt", { sessionId, prompt: [{ type: "text", text: input.prompt }] });
      if (r.error) return fail("the turn", r.error);
      const stopReason = (r.result as { stopReason?: string } | undefined)?.stopReason;
      finish({ stopReason, loaded: input.sessionId ? true : undefined, error: stopReason === "refusal" ? `${agent.label} refused this request.` : undefined });
    })().catch((e: Error) => finish({ error: e.message }));
  });
}

function contentText(c: unknown): string {
  if (!Array.isArray(c)) return "";
  return c
    .map((x: { type?: string; content?: { type?: string; text?: string }; path?: string; newText?: string }) =>
      x?.type === "content" && x.content?.type === "text" ? (x.content.text ?? "") : x?.type === "diff" ? `diff ${x.path ?? ""}` : "",
    )
    .filter(Boolean)
    .join("\n");
}

/** The agent has had its stdin closed; give it a moment to exit by itself, then make sure. */
function killSoon(pid?: number): void {
  if (!pid) return;
  setTimeout(() => {
    try {
      process.kill(pid, 0);
    } catch {
      return; // already gone
    }
    void import("./sessionActions").then((m) => m.killTree(pid)).catch(() => {});
  }, 3000).unref?.();
}

/**
 * "Does this agent work here?" for the settings panel: start it, initialize, open a session in the
 * home folder, and stop. No prompt is sent, so nothing is spent. Reports the agent's name and
 * version, whether it can continue sessions, and a sign-in hint when it isn't signed in.
 */
export function probeAcp(agent: AcpAgent, cwd: string): Promise<{ ok: boolean; detail: string }> {
  return new Promise((resolve) => {
    const env = cleanEnv();
    if (process.env.MC_ALLOW_API_KEYS !== "1") for (const k of ["GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_PROJECT_ID", "GOOGLE_GENAI_USE_VERTEXAI"]) delete env[k];
    // npm installs a .cmd launcher, which needs the shell; arguments are this machine's own and the prompt goes over stdin
    const command = resolveAcpCommand(agent.command) ?? agent.command;
    const shell = process.platform === "win32" && !/\.exe$/i.test(command);
    const child = spawn(shell ? q(command) : command, shell ? agent.args.map(q) : agent.args, { cwd, shell, env, windowsHide: true, detached: process.platform !== "win32" });
    let buf = "";
    let stderr = "";
    let done = false;
    const end = (ok: boolean, detail: string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        child.stdin.end();
      } catch {
        /* closed */
      }
      killSoon(child.pid);
      resolve({ ok, detail });
    };
    const timer = setTimeout(() => end(false, `No answer from ${agent.label} in 45 seconds.`), 45_000);
    const send = (id: number, method: string, params: unknown) => child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    let info = "";
    child.stdout.on("data", (c: Buffer) => {
      buf += c.toString("utf8");
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        let m: Msg;
        try {
          m = JSON.parse(line);
        } catch {
          continue;
        }
        if (m.id === 1) {
          if (m.error) return end(false, `It started but didn't accept the handshake: ${m.error.message ?? "unknown"}.`);
          const r = (m.result ?? {}) as { protocolVersion?: number; agentInfo?: { title?: string; name?: string; version?: string }; agentCapabilities?: { loadSession?: boolean } };
          info = `${r.agentInfo?.title || r.agentInfo?.name || agent.label}${r.agentInfo?.version ? ` ${r.agentInfo.version}` : ""}, protocol ${r.protocolVersion ?? "?"}${r.agentCapabilities?.loadSession ? ", continues sessions" : ", can't reopen sessions (replies carry the conversation instead)"}`;
          send(2, "session/new", { cwd, mcpServers: [] });
        } else if (m.id === 2) {
          if (m.error) {
            const msg = (m.error.message ?? "unknown").replace(/\.\s*$/, "");
            return end(false, `${info}. It can't start a session: ${msg}.${looksSignedOut(msg) ? ` ${presetFor(agent.id)?.signIn ?? "Sign in to it in a terminal."}` : ""}`);
          }
          end(true, `${info}. Ready.`);
        }
      }
    });
    child.stderr.on("data", (c: Buffer) => {
      stderr = (stderr + c.toString("utf8")).slice(-1500);
    });
    child.on("error", (e) => end(false, `Couldn't start ${agent.command}: ${e.message}`));
    child.on("close", (code) => end(false, `${agent.label} exited (code ${code ?? "?"}) before answering.${stderr.trim() ? ` ${stderr.trim().slice(-300)}` : ""}`));
    send(1, "initialize", { protocolVersion: PROTOCOL, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false }, clientInfo: { name: "mission-control", version: "1" } });
  });
}
