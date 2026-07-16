import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import { AGENT_DEFS } from "@/lib/agents-config";
import { readRegistry } from "@/lib/registry";
import type { AgentInfo } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Why is this agent offline? The commonest cause by far is an absolute path in
 * .env.local copied from another machine — `C:\Users\alice\...` on a PC where
 * you're `bob`. "Binary not found" is technically true but sends people
 * reinstalling something that's already there, so name the real problem.
 */
function offlineHint(binary: string): string | undefined {
  const looksLikePath = binary.includes("\\") || binary.includes("/");
  if (!looksLikePath || fs.existsSync(binary)) return undefined;
  const me = os.userInfo().username;
  const named = binary.match(/[\\/]Users[\\/]([^\\/]+)/i)?.[1];
  if (named && me && named.toLowerCase() !== me.toLowerCase()) {
    return `This path is for user "${named}", but you're signed in as "${me}" — .env.local was likely copied from another machine. Fix the path (and restart) rather than reinstalling.`;
  }
  return `The configured path doesn't exist on this machine. Check HERMES_BIN / the agent's binary in .env.local.`;
}

interface ProbeResult {
  available: boolean;
  version: string | null;
}

/**
 * Success is cached forever; failure only for 60s — at cold boot slow-waking
 * CLIs (Hermes' Python venv, npm shims) time out once and must be re-probed,
 * not marked offline for the whole server lifetime.
 */
const cache = new Map<string, { result: ProbeResult; expires: number }>();
const inFlight = new Map<string, Promise<ProbeResult>>();

function probe(binary: string, versionArgs: string[]): Promise<ProbeResult> {
  const cached = cache.get(binary);
  if (cached && (cached.result.available || Date.now() < cached.expires)) {
    return Promise.resolve(cached.result);
  }
  const pending = inFlight.get(binary);
  if (pending) return pending;

  const p = new Promise<ProbeResult>((resolve) => {
    execFile(binary, versionArgs, { shell: true, timeout: 45_000 }, (err, stdout) => {
      const result: ProbeResult = err
        ? { available: false, version: null }
        : { available: true, version: stdout.trim().split("\n")[0] || null };
      cache.set(binary, { result, expires: result.available ? Infinity : Date.now() + 60_000 });
      resolve(result);
    });
  }).finally(() => {
    inFlight.delete(binary);
  });
  inFlight.set(binary, p);
  return p;
}

export async function GET() {
  const registry = await readRegistry();
  const defs = [
    ...AGENT_DEFS.map((d) => ({ ...d, versionArgs: d.versionArgs })),
    ...registry.commandAgents.map((a) => ({
      id: a.id,
      name: a.name,
      tagline: a.tagline,
      accent: a.accent,
      binary: a.binary,
      commandTemplate: a.commandTemplate,
      versionArgs: ["--version"],
    })),
  ];
  const agents: AgentInfo[] = await Promise.all(
    defs.map(async (def) => {
      const { available, version } = await probe(def.binary, def.versionArgs);
      return {
        id: def.id,
        name: def.name,
        tagline: def.tagline,
        accent: def.accent,
        binary: def.binary,
        commandTemplate: def.commandTemplate,
        available,
        version,
        hint: available ? undefined : offlineHint(def.binary),
      };
    }),
  );
  return Response.json(agents);
}
