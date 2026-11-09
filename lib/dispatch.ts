import os from "os";
import { readConfig } from "./cluster";
import { sessionsSnapshot, type SessionTool, type SubscriptionMeter } from "./sessions";
import { mergeRemoteSessions } from "./sessionShare";
import { listJobs } from "./sessionActions";
import { modeOf, readNetwork } from "./peer";

/**
 * "Run this somewhere": rank the machines that could take a task right now.
 * A machine qualifies when it's online, accepts work from other machines
 * (always true for this one), has the project's folder (when a project is
 * picked) and its Claude / ChatGPT account isn't at its limit. Among those,
 * less-used subscriptions and fewer running sessions win; a LAN machine beats
 * an Off-LAN one, and this machine gets a small edge.
 */

export interface Candidate {
  host: string;
  label: string;
  local: boolean;
  ok: boolean;
  score: number;
  /** where it would run ("~" = the home folder) */
  folder?: string;
  reasons: string[];
  /** why it can't take the task */
  blocked?: string;
}

export async function rankMachines(input: { project?: string; tool: SessionTool }): Promise<Candidate[]> {
  const snap = await sessionsSnapshot();
  const [{ sessions, remote }, cfg, jobs, net] = await Promise.all([mergeRemoteSessions(snap.sessions), readConfig().catch(() => null), listJobs(), readNetwork()]);
  const toolName = input.tool === "claude" ? "Claude" : "ChatGPT / Codex";
  const machines = [
    { host: os.hostname(), label: cfg?.label || os.hostname(), local: true, online: true, via: "self", accepts: "edit", subs: snap.subscriptions as SubscriptionMeter[] },
    ...remote.map((m) => ({ host: m.host, label: m.label, local: false, online: !m.stale, via: m.via, accepts: m.acceptsReplies as string, subs: m.subscriptions })),
  ];
  const out: Candidate[] = [];
  for (const m of machines) {
    const reasons: string[] = [];
    let blocked: string | undefined;
    if (!m.online) blocked = "offline";
    else if (m.accepts === "off") blocked = 'doesn\'t accept work from other machines (Fleet → Sharing → "Replies from my other machines")';

    let folder: string | undefined = "~";
    if (input.project) {
      const withFolder = sessions
        .filter((s) => s.host === m.host && s.project === input.project && (s.folder || s.cwd))
        .sort((a, b) => b.updatedAt - a.updatedAt)[0];
      folder = withFolder ? withFolder.folder || withFolder.cwd : undefined;
      if (!folder && !blocked) blocked = `doesn't have the ${input.project} folder`;
      else if (folder) reasons.push("has the project folder");
    }

    const meter = m.subs.find((s) => s.tool === input.tool);
    let used = 50;
    if (!meter || meter.status === "not_set_up") {
      if (!blocked && input.tool === "codex") blocked = "Codex isn't set up there";
    } else if (meter.status === "limited") {
      if (!blocked) blocked = `${toolName} limit reached${meter.resetsAt ? ` (resets ${new Date(meter.resetsAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })})` : ""}`;
    } else if (typeof meter.usedPercent === "number") {
      used = meter.usedPercent;
      reasons.push(`${toolName} ${Math.round(used)}% used${meter.windowLabel ? ` (${meter.windowLabel})` : ""}`);
    }

    const busy =
      sessions.filter((s) => s.host === m.host && (s.status === "running" || s.status === "waiting")).length +
      jobs.filter((j) => j.host === m.host && (j.status === "running" || j.status === "queued")).length;
    reasons.push(busy ? `${busy} session${busy > 1 ? "s" : ""} busy` : "nothing running");
    const offlan = !m.local && modeOf(net, m.host) === "offlan";
    if (!m.local) reasons.push(m.via === "lan" ? "on the LAN" : offlan ? "Off-LAN (through OneDrive)" : "through OneDrive");
    else reasons.push("this machine");

    const score = (used / 100) * 2 + busy * 0.6 + (m.local ? -0.2 : 0) + (!m.local && m.via !== "lan" ? 0.5 : 0);
    out.push({ host: m.host, label: m.label, local: m.local, ok: !blocked, score, folder, reasons, blocked });
  }
  return out.sort((a, b) => Number(b.ok) - Number(a.ok) || a.score - b.score);
}
