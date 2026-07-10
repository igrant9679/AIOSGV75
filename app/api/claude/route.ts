import { spawn } from "child_process";
import os from "os";
import { gatherContext, memoryBlock } from "@/lib/retrieval";
import { mcpArgs } from "@/lib/mcp";
import type { ClaudeRunOptions } from "@/lib/types";

export const dynamic = "force-dynamic";

const SAFE_ID = /^[a-zA-Z0-9_-]+$/;
const SAFE_MODEL = /^[a-zA-Z0-9._-]+$/;
const PERMISSION_MODES = new Set(["default", "acceptEdits", "plan", "bypassPermissions"]);

/**
 * Bridge to the Claude Code CLI. Spawns `claude -p` with stream-json output
 * and relays each NDJSON event to the browser as an SSE `data:` frame.
 * The prompt travels via stdin so no user text ever touches the shell line.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as ClaudeRunOptions & { injectMemory?: boolean };
  let prompt = (body.prompt ?? "").toString();
  if (!prompt.trim()) {
    return Response.json({ error: "prompt is required" }, { status: 400 });
  }
  if (body.injectMemory) {
    prompt = memoryBlock(await gatherContext(prompt)) + prompt;
  }

  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
  ];
  if (body.sessionId && SAFE_ID.test(body.sessionId)) {
    args.push("--resume", body.sessionId);
  }
  if (body.model && SAFE_MODEL.test(body.model)) {
    args.push("--model", body.model);
  }
  if (body.permissionMode && PERMISSION_MODES.has(body.permissionMode)) {
    args.push("--permission-mode", body.permissionMode);
  }
  // registered MCP servers (Settings → MCP) ride along on every bridge run
  args.push(...(await mcpArgs()));

  const cwd = body.cwd && body.cwd.trim() ? body.cwd : os.homedir();

  // Strip inherited session/proxy vars (e.g. when the dev server was launched
  // from inside another Claude Code session) so the CLI authenticates with its
  // own stored credentials — but keep ANTHROPIC_API_KEY so a key set in
  // .env.local works as the auth method.
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key === "ANTHROPIC_API_KEY") continue;
    if (key.startsWith("CLAUDE_") || key.startsWith("ANTHROPIC_") || key === "CLAUDECODE") delete env[key];
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // shell:true because the global `claude` is a .cmd shim on Windows.
      // Every arg above is either a fixed flag or regex-validated.
      const child = spawn("claude", args, { cwd, shell: true, env });

      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(`data: ${typeof obj === "string" ? obj : JSON.stringify(obj)}\n\n`));

      let buffer = "";
      let closed = false;
      const finish = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      child.stdout.on("data", (chunk: Buffer) => {
        buffer += chunk.toString("utf8");
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed) send(trimmed);
        }
      });

      let stderrTail = "";
      child.stderr.on("data", (chunk: Buffer) => {
        stderrTail = (stderrTail + chunk.toString("utf8")).slice(-2000);
      });

      child.on("error", (err) => {
        send({ type: "bridge_error", message: `Failed to launch claude CLI: ${err.message}` });
        finish();
      });

      child.on("close", (code) => {
        if (buffer.trim()) send(buffer.trim());
        if (code !== 0) {
          send({ type: "bridge_error", message: `claude exited with code ${code}`, stderr: stderrTail });
        }
        send({ type: "bridge_done" });
        finish();
      });

      request.signal.addEventListener("abort", () => {
        child.kill();
        finish();
      });

      child.stdin.write(prompt);
      child.stdin.end();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
