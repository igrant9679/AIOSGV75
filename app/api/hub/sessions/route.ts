import os from "os";
import { sessionsSnapshot } from "@/lib/sessions";
import { readThread } from "@/lib/sessionThread";
import { readShareSettings } from "@/lib/sessionShare";
import { renameSessions, setHidden } from "@/lib/sessionNaming";
import { dismissJob, listJobs, openLocal, readJobThread, sessionJobsTick, startJob, type JobAccess, type JobMode, type OpenWhat } from "@/lib/sessionActions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const KEY_RE = /^(claude|codex):[\w-]+$/;

/**
 * GET                     → { host, jobs, remoteReplies }
 * GET ?thread=<key>       → full thread of a session on THIS machine (tool calls included)
 *        &limit=<n>          newest n entries (default 600, 0 = all)
 * GET ?jobThread=<jobId>  → full thread fetched from another machine
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  try {
    const key = url.searchParams.get("thread");
    if (key) {
      if (!KEY_RE.test(key)) return Response.json({ error: "bad key" }, { status: 400 });
      const snap = await sessionsSnapshot();
      const s = snap.sessions.find((x) => x.key === key);
      if (!s) return Response.json({ error: "not on this machine", remote: true }, { status: 404 });
      const limit = Math.max(0, Math.min(Number(url.searchParams.get("limit") ?? 600) || 0, 20_000));
      const t = await readThread(s, limit);
      if (!t) return Response.json({ error: "The session file couldn't be found." }, { status: 404 });
      return Response.json(t);
    }
    const jobThread = url.searchParams.get("jobThread");
    if (jobThread) {
      const t = await readJobThread(jobThread);
      return t ? Response.json(t) : Response.json({ error: "not fetched yet" }, { status: 404 });
    }
    const [jobs, settings] = await Promise.all([listJobs(), readShareSettings()]);
    return Response.json({ host: os.hostname(), jobs, remoteReplies: settings.remoteReplies });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

/**
 * { action: "reply", key, prompt, access?, fork? }
 * { action: "new", host, folder, tool, project?, prompt, access? }
 * { action: "thread", key }                     (a session on another machine)
 * { action: "open", what: terminal|folder|editor, key? | folder?, tool? }
 * { action: "hide", keys, hidden }
 * { action: "move", keys, project }             ("" = automatic project)
 * { action: "dismiss", id }
 * { action: "sync" }                            (exchange with other machines now)
 */
export async function POST(req: Request) {
  let b: {
    action?: string;
    key?: string;
    keys?: unknown;
    prompt?: string;
    access?: string;
    fork?: boolean;
    host?: string;
    folder?: string;
    tool?: string;
    project?: string;
    what?: string;
    hidden?: boolean;
    id?: string;
  };
  try {
    b = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  const keys = Array.isArray(b.keys) ? (b.keys as unknown[]).filter((k): k is string => typeof k === "string" && KEY_RE.test(k)) : [];
  try {
    switch (b.action) {
      case "reply":
      case "new":
      case "thread": {
        if (b.action !== "new" && (!b.key || !KEY_RE.test(b.key))) return Response.json({ error: "bad key" }, { status: 400 });
        const job = await startJob({
          mode: b.action as JobMode,
          key: b.key,
          prompt: b.prompt,
          access: (b.access === "edit" ? "edit" : "answer") as JobAccess,
          fork: b.fork === true,
          host: b.host,
          folder: b.folder,
          tool: b.tool === "codex" ? "codex" : "claude",
          project: typeof b.project === "string" ? b.project.slice(0, 80) : undefined,
        });
        return Response.json({ job });
      }
      case "open": {
        const what = (["terminal", "folder", "editor"].includes(b.what ?? "") ? b.what : "folder") as OpenWhat;
        const message = await openLocal(what, {
          key: b.key && KEY_RE.test(b.key) ? b.key : undefined,
          folder: b.folder,
          tool: b.tool === "codex" ? "codex" : "claude",
        });
        return Response.json({ ok: true, message });
      }
      case "hide":
        if (!keys.length) return Response.json({ error: "no sessions" }, { status: 400 });
        await setHidden(keys, b.hidden !== false);
        return Response.json({ ok: true });
      case "move":
        if (!keys.length) return Response.json({ error: "no sessions" }, { status: 400 });
        await renameSessions(keys, { project: typeof b.project === "string" ? b.project : "" });
        return Response.json({ ok: true });
      case "dismiss":
        if (b.id) await dismissJob(b.id);
        return Response.json({ ok: true });
      case "sync":
        // pick up requests from / results for other machines now, not at the next 15 s tick
        await sessionJobsTick(0);
        return Response.json({ ok: true, jobs: await listJobs() });
      default:
        return Response.json({ error: "unknown action" }, { status: 400 });
    }
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
