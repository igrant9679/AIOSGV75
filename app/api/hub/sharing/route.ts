import os from "os";
import { readConfig } from "@/lib/cluster";
import { readRemoteSessions, readShareSettings, readShareState, shareNow, writeShareSettings } from "@/lib/sessionShare";
import { toolMemoryCounts } from "@/lib/toolMemory";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function status() {
  const [cfg, settings, last, remote, memory] = await Promise.all([
    readConfig().catch(() => null),
    readShareSettings(),
    readShareState(),
    readRemoteSessions().catch(() => []),
    toolMemoryCounts().catch(() => []),
  ]);
  return {
    host: os.hostname(),
    label: cfg?.label || os.hostname(),
    clusterOn: Boolean(cfg?.enabled),
    settings,
    last,
    remote: remote.map((f) => ({ host: f.host, label: f.label || f.host, publishedAt: f.publishedAt, sessions: f.sessions.length })),
    memory,
  };
}

/** What this machine shares, when it last did, and what the other machines publish. */
export async function GET() {
  try {
    return Response.json(await status());
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

/**
 * { action: "run" } — share now
 * { action: "settings", conversations?: boolean, toolMemory?: boolean }
 */
export async function POST(req: Request) {
  let body: { action?: string; conversations?: unknown; toolMemory?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  try {
    if (body.action === "settings") {
      const patch: { conversations?: boolean; toolMemory?: boolean } = {};
      if (typeof body.conversations === "boolean") patch.conversations = body.conversations;
      if (typeof body.toolMemory === "boolean") patch.toolMemory = body.toolMemory;
      await writeShareSettings(patch);
      return Response.json(await status());
    }
    if (body.action === "run") {
      await shareNow();
      return Response.json(await status());
    }
    return Response.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
