import { randomUUID } from "crypto";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { readAlertSettings } from "./sessionEvents";
import { clusterStatus, readConfig } from "./cluster";
import { PeerUnavailable, peerFetch } from "./peer";
import { sendTelegram } from "./telegram";
import { productName } from "./netSettings";

/**
 * Permission prompts answered from the app.
 *
 * Claude Code's PermissionRequest hook (scripts/mc-hook.mjs permission) asks the app
 * on its own machine before Claude shows a permission prompt. If the network's setting
 * wants it (Fleet → Session alerts → Permission prompts), the request is recorded here
 * and the hook waits while you Allow / Deny it from any machine on the LAN (or a phone
 * using Phone access). No answer in time: the hook steps aside - a terminal session
 * shows its normal prompt, a headless run (the app's own replies) is denied.
 */
export type PermissionStatus = "pending" | "allowed" | "denied" | "expired";

export interface PermissionRequest {
  id: string;
  host: string;
  hostLabel: string;
  sessionId: string;
  /** "claude:<sessionId>" - the session's key in the app */
  key: string;
  cwd: string;
  toolName: string;
  /** one line, e.g. "$ npm test", "Edit page.tsx" */
  summary: string;
  /** the tool's input, as JSON (clipped) */
  input: string;
  /** Claude Code's "always allow" rule suggestions (passed back as updatedPermissions) */
  suggestions?: unknown[];
  /** set when one of the app's own runs asked (the job id) */
  jobId?: string;
  headless: boolean;
  createdAt: number;
  expiresAt: number;
  status: PermissionStatus;
  decidedAt?: number;
  decidedBy?: string;
  always?: boolean;
  message?: string;
}

const FILE = path.join(process.cwd(), "data", "permissions.json");
const KEEP = 200;
/** the app's own (headless) runs wait this long - they have nobody at a terminal */
const HEADLESS_WAIT_MS = 10 * 60_000;

const me = () => os.hostname();

async function readAll(): Promise<PermissionRequest[]> {
  try {
    const j = JSON.parse(await fsp.readFile(FILE, "utf8"));
    return Array.isArray(j) ? (j as PermissionRequest[]) : [];
  } catch {
    return [];
  }
}

let chain: Promise<unknown> = Promise.resolve();
/** Serialised read-modify-write of the store. */
function mutate<T>(fn: (all: PermissionRequest[]) => T): Promise<T> {
  const run = chain.then(async () => {
    const all = await readAll();
    const now = Date.now();
    for (const r of all) if (r.status === "pending" && r.expiresAt <= now) r.status = "expired";
    const out = fn(all);
    await fsp.mkdir(path.dirname(FILE), { recursive: true });
    const tmp = `${FILE}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(all.slice(-KEEP), null, 1), "utf8");
    await fsp.rename(tmp, FILE);
    return out;
  });
  chain = run.catch(() => {});
  return run;
}

function describe(tool: string, input: Record<string, unknown>): string {
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  const base = (p: string) => p.split(/[\\/]/).pop() || p;
  const clip = (t: string, n = 140) => (t.length > n ? t.slice(0, n - 1) + "…" : t);
  if (tool === "Bash" || tool === "PowerShell") return clip(`$ ${s(input.command).replace(/\s+/g, " ")}`);
  if (["Read", "Edit", "Write", "MultiEdit", "NotebookEdit"].includes(tool)) return `${tool} ${base(s(input.file_path) || s(input.notebook_path))}`;
  if (tool === "WebFetch") return clip(`Fetch ${s(input.url)}`);
  if (tool === "WebSearch") return clip(`Search: ${s(input.query)}`);
  if (tool === "Grep" || tool === "Glob") return clip(`${tool} ${s(input.pattern)}`);
  return tool.replace(/^mcp__([^_]+)__/, "$1: ");
}

export interface HookAsk {
  payload: { session_id?: string; cwd?: string; tool_name?: string; tool_input?: Record<string, unknown>; permission_suggestions?: unknown[] };
  jobId?: string;
  headless?: boolean;
}

/** From the hook: should it wait for an answer from the app, and for how long? */
export async function askPermission(a: HookAsk): Promise<{ id: string; waitMs: number } | { skip: string }> {
  const settings = await readAlertSettings();
  const mode = settings.permissions.mode;
  const headless = Boolean(a.jobId || a.headless);
  if (mode === "off") return { skip: "off" };
  if (!headless && mode !== "all") return { skip: "terminal sessions answer in the terminal" };
  const p = a.payload ?? {};
  if (!p.session_id || !p.tool_name) return { skip: "not a permission request" };
  const waitMs = headless ? HEADLESS_WAIT_MS : settings.permissions.waitSeconds * 1000;
  const cfg = await readConfig().catch(() => null);
  const input = p.tool_input ?? {};
  const req: PermissionRequest = {
    id: randomUUID(),
    host: me(),
    hostLabel: cfg?.label || me(),
    sessionId: p.session_id,
    key: `claude:${p.session_id}`,
    cwd: p.cwd ?? "",
    toolName: p.tool_name,
    summary: describe(p.tool_name, input),
    input: JSON.stringify(input, null, 1).slice(0, 4000),
    suggestions: Array.isArray(p.permission_suggestions) && p.permission_suggestions.length ? p.permission_suggestions.slice(0, 5) : undefined,
    jobId: a.jobId,
    headless,
    createdAt: Date.now(),
    expiresAt: Date.now() + waitMs,
    status: "pending",
  };
  await mutate((all) => all.push(req));
  if (settings.telegram.permissions) {
    const where = path.basename(req.cwd) || req.cwd;
    void sendTelegram(`🔐 Permission needed on ${req.hostLabel} (${where}):\n${req.summary}\n\nAnswer in ${productName()} (Fleet or any page) within ${Math.round(waitMs / 1000)}s.`).catch(() => false);
  }
  return { id: req.id, waitMs };
}

/** Claude Code's PermissionRequest hook output for a decided request. */
export function hookOutput(r: PermissionRequest): unknown {
  if (r.status === "allowed") {
    return {
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: { behavior: "allow", ...(r.always && r.suggestions ? { updatedPermissions: r.suggestions } : {}) },
      },
    };
  }
  if (r.status === "denied") {
    return {
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: { behavior: "deny", message: r.message || `Denied from ${productName()}${r.decidedBy ? ` (${r.decidedBy})` : ""}.` },
      },
    };
  }
  return null;
}

/** The hook long-polls this: returns as soon as it's decided, or after `maxMs`. */
export async function waitForDecision(id: string, maxMs = 25_000): Promise<{ status: PermissionStatus; output: unknown } | null> {
  const until = Date.now() + maxMs;
  for (;;) {
    const r = (await readAll()).find((x) => x.id === id);
    if (!r) return null;
    const expired = r.status === "pending" && r.expiresAt <= Date.now();
    if (expired) await mutate(() => undefined); // marks it expired
    const status: PermissionStatus = expired ? "expired" : r.status;
    if (status !== "pending" || Date.now() >= until) return { status, output: status === "pending" ? null : hookOutput({ ...r, status }) };
    await new Promise((res) => setTimeout(res, 400));
  }
}

/** Requests on this machine still waiting for an answer. */
export async function pendingLocal(): Promise<PermissionRequest[]> {
  const now = Date.now();
  return (await readAll()).filter((r) => r.status === "pending" && r.expiresAt > now);
}

/** Answer a request on this machine. */
export async function decideLocal(id: string, behavior: "allow" | "deny", opts: { always?: boolean; message?: string; by?: string } = {}): Promise<PermissionRequest> {
  const r = await mutate((all) => {
    const x = all.find((y) => y.id === id);
    if (!x) return { err: "That request isn't on this machine." };
    if (x.status !== "pending") return { err: x.status === "expired" ? "Too late - it already went back to the terminal (or was denied)." : `Already ${x.status}.` };
    x.status = behavior === "allow" ? "allowed" : "denied";
    x.decidedAt = Date.now();
    x.decidedBy = opts.by;
    x.always = behavior === "allow" && Boolean(opts.always);
    x.message = opts.message?.slice(0, 300);
    return { ok: { ...x } };
  });
  if ("err" in r) throw Object.assign(new Error(r.err), { status: 409 });
  return r.ok;
}

let fleetCache: { at: number; items: PermissionRequest[]; unreachable: string[] } | null = null;
/** Waiting requests on every machine reachable over the LAN (this one included). */
export async function pendingFleet(): Promise<{ items: PermissionRequest[]; unreachable: string[] }> {
  if (fleetCache && Date.now() - fleetCache.at < 1_500) return fleetCache;
  const st = await clusterStatus().catch(() => null);
  const others = (st?.nodes ?? []).filter((n) => !n.self && n.online);
  const unreachable: string[] = [];
  const remote = await Promise.all(
    others.map((n) =>
      peerFetch<{ items: PermissionRequest[] }>(n.host, "/peer/permissions", { timeoutMs: 1_500 })
        .then((r) => r.items ?? [])
        .catch((e) => {
          if (e instanceof PeerUnavailable) unreachable.push(n.label || n.host);
          return [] as PermissionRequest[];
        }),
    ),
  );
  const items = [...(await pendingLocal()), ...remote.flat()].sort((a, b) => a.createdAt - b.createdAt);
  fleetCache = { at: Date.now(), items, unreachable };
  return fleetCache;
}

/** Answer a request on any machine (over the LAN for other machines). */
export async function decideFleet(host: string, id: string, behavior: "allow" | "deny", opts: { always?: boolean; message?: string } = {}): Promise<PermissionRequest> {
  fleetCache = null;
  const cfg = await readConfig().catch(() => null);
  const by = cfg?.label || me();
  if (!host || host === me()) return decideLocal(id, behavior, { ...opts, by });
  const r = await peerFetch<{ request: PermissionRequest }>(host, "/peer/permission", { body: { id, behavior, ...opts, by }, timeoutMs: 5_000 });
  return r.request;
}
