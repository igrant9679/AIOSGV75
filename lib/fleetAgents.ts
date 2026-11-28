import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { vaultAvailable, vaultInfo } from "./vault";
import { cleanAgent, agentPrompt, dueSlot, isSignInFailure, type FleetAgent, type AgentRun } from "./fleetAgentRules";

/**
 * Fleet agents (/agents, rule 50): the owner's own standing agents. Each has a name, a persona, a standing
 * task, the engine it runs on, the machine (or Auto: the best one at the time), what it may do, and an
 * optional schedule. A run is an ordinary session job (lib/sessionActions.ts), so it obeys every rule
 * jobs already obey (access levels, the target machine's own settings, logging) and shows on the Board.
 *
 * Kept in the vault (Agentic OS/Cluster/fleet-agents.json) so every machine sees the same agents: the
 * definitions are the owner's own words. Scheduled runs are started by the MASTER only, never while the
 * fleet is paused; each machine follows the runs it started and writes their outcome back.
 */

const file = () => path.join(vaultInfo().base, "Cluster", "fleet-agents.json");

export function readAgents(): FleetAgent[] {
  try {
    const j = JSON.parse(fs.readFileSync(file(), "utf8"));
    return Array.isArray(j?.agents) ? j.agents : [];
  } catch {
    return [];
  }
}

let chain: Promise<unknown> = Promise.resolve();
function mutate<T>(fn: (agents: FleetAgent[]) => T | Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    if (!(await vaultAvailable())) throw new Error("The vault isn't available on this machine, and agents are kept in it.");
    const agents = readAgents();
    const out = await fn(agents);
    const f = file();
    await fsp.mkdir(path.dirname(f), { recursive: true });
    const tmp = `${f}.${process.pid}.${Date.now()}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify({ v: 1, agents }, null, 1), "utf8");
    for (let i = 0; ; i++) {
      try {
        await fsp.rename(tmp, f);
        break;
      } catch (e) {
        if (i >= 8) throw e; // the vault is a OneDrive folder (rule 24)
        await new Promise((r) => setTimeout(r, 250 * (i + 1)));
      }
    }
    return out;
  });
  chain = run.catch(() => {});
  return run;
}

export async function saveAgent(raw: unknown): Promise<FleetAgent> {
  return mutate((agents) => {
    const id = (raw as { id?: string })?.id;
    const i = id ? agents.findIndex((a) => a.id === id) : -1;
    const next = cleanAgent(raw, i >= 0 ? agents[i] : undefined);
    if (agents.some((a) => a.id !== next.id && a.name.toLowerCase() === next.name.toLowerCase())) throw new Error(`There is already an agent called ${next.name}.`);
    if (i >= 0) agents[i] = next;
    else agents.push(next);
    return next;
  });
}
export async function deleteAgent(id: string): Promise<void> {
  await mutate((agents) => {
    const i = agents.findIndex((a) => a.id === id);
    if (i >= 0) agents.splice(i, 1);
  });
}
export async function setAgentEnabled(id: string, enabled: boolean): Promise<void> {
  await mutate((agents) => {
    const a = agents.find((x) => x.id === id);
    if (a) a.enabled = enabled;
  });
}

/** Start one run of an agent now (from this machine). */
export async function runAgent(id: string, opts: { note?: string; scheduled?: boolean; slot?: string; exclude?: string[]; carry?: string } = {}): Promise<AgentRun> {
  const a = readAgents().find((x) => x.id === id);
  if (!a) throw new Error("That agent isn't there any more.");
  const { startJob } = await import("./sessionActions");
  const { rankMachines } = await import("./dispatch");
  let host = a.machine;
  let folder = a.folder || "~";
  if (host === "auto") {
    const best = (await rankMachines({ tool: a.tool })).find((c) => c.ok && !(opts.exclude ?? []).includes(c.host));
    if (!best) throw new Error("No machine can take it right now.");
    host = best.host;
    if (folder === "~") folder = best.folder ?? "~";
  }
  const job = await startJob({ mode: "new", host, folder, tool: a.tool, prompt: agentPrompt(a, opts.note), access: a.access, web: a.web, project: a.name, dispatch: `Agent · ${a.name}` });
  const failed = job.status === "error";
  const run: AgentRun = { at: Date.now(), jobId: job.id, host: job.host, hostLabel: job.hostLabel, status: failed ? "failed" : "started", summary: failed ? String(job.error ?? "").slice(0, 300) : undefined, scheduled: opts.scheduled, tried: [...(opts.exclude ?? []), job.host], note: opts.carry };
  await mutate((agents) => {
    const x = agents.find((y) => y.id === id);
    if (!x) return;
    x.runs = [run, ...(x.runs ?? [])].slice(0, 12);
    if (opts.slot) x.lastSlot = opts.slot;
  });
  if (failed) throw new Error(run.summary || "It couldn't be started.");
  return run;
}

/**
 * Every minute (scheduler instance): the master starts the scheduled agents that are due (never while
 * paused), and every machine writes back the outcome of the runs it started.
 */
let busy = false;
export async function fleetAgentsTick(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    const agents = readAgents();
    if (!agents.length) return;
    // outcomes of runs started here
    const open = agents.flatMap((a) => (a.runs ?? []).filter((r) => r.status === "started" && r.jobId).map((r) => ({ a, r })));
    if (open.length) {
      const { listJobs } = await import("./sessionActions");
      const jobs = await listJobs();
      const settled = new Map<string, { status: AgentRun["status"]; summary: string; key?: string }>();
      for (const { r } of open) {
        const j = jobs.find((x) => x.id === r.jobId);
        if (!j) continue; // started on another machine: that machine settles it
        if (j.status === "done") settled.set(r.jobId!, { status: "done", summary: String(j.reply ?? "").slice(0, 1500), key: j.resultKey });
        else if (j.status === "error" || j.status === "expired") settled.set(r.jobId!, { status: "failed", summary: String(j.error ?? j.status).slice(0, 300) });
      }
      if (settled.size) {
        await mutate((all) => {
          for (const a of all) for (const r of a.runs ?? []) if (r.jobId && settled.has(r.jobId)) Object.assign(r, settled.get(r.jobId));
        });
        // Auto placement: a machine that turned out not to be signed in (or not to have the tool) isn't the
        // end of the run. Try the next-best machine, up to three in all, and say which one needs attention.
        for (const { a, r } of open) {
          const s = settled.get(r.jobId!);
          if (!s || s.status !== "failed" || a.machine !== "auto" || !isSignInFailure(s.summary)) continue;
          const tried = r.tried ?? (r.host ? [r.host] : []);
          if (tried.length >= 3) continue;
          const carry = `${r.note ? `${r.note} ` : ""}${r.hostLabel ?? r.host} couldn't run it (${s.summary.slice(0, 80)}).`;
          await runAgent(a.id, { scheduled: r.scheduled, exclude: tried, carry }).catch((e) => console.warn(`[agents] ${a.name} retry: ${(e as Error).message}`));
        }
      }
    }
    // scheduled runs: the master's duty
    const { clusterStatus } = await import("./cluster");
    const st: any = await clusterStatus().catch(() => null);
    if (st?.config?.enabled && !st.masterIsSelf) return;
    const { isPaused } = await import("./fleetPause");
    if (isPaused()) return;
    const now = new Date();
    for (const a of readAgents()) {
      if (!a.enabled || !a.schedule) continue;
      const slot = dueSlot(a.schedule, now);
      if (!slot || slot === a.lastSlot) continue;
      // claim the slot first, so a failure to start isn't retried every minute
      await mutate((all) => {
        const x = all.find((y) => y.id === a.id);
        if (x) x.lastSlot = slot;
      });
      await runAgent(a.id, { scheduled: true, slot }).catch((e) => console.warn(`[agents] ${a.name}: ${(e as Error).message}`));
    }
  } catch (e) {
    console.warn("[agents] tick:", (e as Error).message);
  } finally {
    busy = false;
  }
}
