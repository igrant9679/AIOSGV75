import { spawn } from "child_process";
import os from "os";
import { getAgentDef } from "@/lib/agents-config";
import { findCommandAgent } from "@/lib/registry";
import { gatherContext, memoryBlock } from "@/lib/retrieval";

export const dynamic = "force-dynamic";

/**
 * Runs a registered companion agent. The command comes exclusively from the
 * server-side registry; the browser only picks an agent id and supplies the
 * message. If the template has an {input} placeholder the message is inlined
 * (quoted), otherwise it is piped to the process on stdin.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as { agentId?: string; input?: string; injectMemory?: boolean };
  const def = body.agentId ? (getAgentDef(body.agentId) ?? (await findCommandAgent(body.agentId))) : undefined;
  let input = (body.input ?? "").toString();

  if (!def) return Response.json({ error: "unknown agent" }, { status: 400 });
  if (!input.trim()) return Response.json({ error: "input is required" }, { status: 400 });
  if (body.injectMemory) {
    input = memoryBlock(await gatherContext(input)) + input;
  }

  const useStdin = !def.commandTemplate.includes("{input}");
  const command = useStdin
    ? def.commandTemplate
    : def.commandTemplate.replace("{input}", JSON.stringify(input));

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const child = spawn(command, [], { cwd: os.homedir(), shell: true });

      const send = (obj: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

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

      child.stdout.on("data", (chunk: Buffer) => send({ type: "stdout", text: chunk.toString("utf8") }));
      child.stderr.on("data", (chunk: Buffer) => send({ type: "stderr", text: chunk.toString("utf8") }));

      child.on("error", (err) => {
        send({ type: "error", message: err.message });
        finish();
      });

      child.on("close", (code) => {
        send({ type: "done", code });
        finish();
      });

      request.signal.addEventListener("abort", () => {
        child.kill();
        finish();
      });

      if (useStdin) child.stdin.write(input + "\n");
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
