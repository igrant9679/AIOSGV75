import fsp from "fs/promises";
import os from "os";
import path from "path";
import { listJobs, startJob, type JobAccess, type SessionJob } from "./sessionActions";
import { isSessionTool, splitAcpId, toolLabel, toolOfKey, type SessionTool } from "./sessionTools";
import { isPaused } from "./fleetPause";
import { readConfig } from "./cluster";
import { handoffs, mentions } from "./teamParse";

export { handoffs, mentions };

/**
 * Command → Team: named teammates with roles, each working in a real session of its own, in one
 * channel. You write "@Ada fix the sign-in test"; Ada's message goes to Ada's session (a new one the
 * first time, with her role and the team list; a reply after that, held until the session is free).
 * When her reply ends with "@Linus: review session.ts", Linus gets that as his next message, and so on.
 *
 * Everything travels as ordinary session jobs (lib/sessionActions.ts), so a teammate can live on
 * another machine with that machine's tools and permissions, a teammate whose plan hits its limit
 * carries on with the next tool (lib/fallback.ts; the channel says "Ada now uses Codex"), and you can
 * open any teammate's session on the Projects page.
 *
 * Limits: a chain of hand-offs stops after MAX_HOPS without you; hand-offs are held while the fleet
 * is paused (rule 32: they are work nobody asked for directly); a teammate can't hand work to
 * itself. data/team.json is this machine's (the channel is driven from here); only the scheduler's
 * module instance settles jobs and sends hand-offs, so two instances can't send one twice (rule 1).
 */

export interface TeamMember {
  id: string;
  name: string;
  role: string;
  tool: SessionTool;
  agent?: string;
  agentLabel?: string;
  host: string;
  hostLabel: string;
  /** the project folder on that machine ("~" = home) */
  folder: string;
  project?: string;
  access: JobAccess;
  /** the teammate's own session, once it has one */
  sessionKey?: string;
  createdAt: number;
}

export interface TeamMessage {
  id: string;
  ts: number;
  /** "you", a member id, or "system" */
  from: string;
  text: string;
  /** a message to a teammate: who, its job, and how it's going */
  to?: string;
  jobId?: string;
  status?: "waiting" | "working" | "done" | "error" | "held";
  /** hand-offs since you last wrote (you = 0) */
  hop: number;
}

export interface TeamFile {
  members: TeamMember[];
  messages: TeamMessage[];
}

const FILE = path.join(process.cwd(), "data", "team.json");
export const MAX_HOPS = 6;
const MAX_MESSAGES = 400;
const NAME_RE = /^[A-Za-z][\w-]{0,23}$/;
const me = () => os.hostname();
let seq = 0;
const newId = (p: string) => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export async function readTeam(): Promise<TeamFile> {
  try {
    const t = JSON.parse(await fsp.readFile(FILE, "utf8")) as TeamFile;
    return { members: Array.isArray(t.members) ? t.members : [], messages: Array.isArray(t.messages) ? t.messages : [] };
  } catch {
    return { members: [], messages: [] };
  }
}

let chain: Promise<unknown> = Promise.resolve();
function mutate<T>(fn: (t: TeamFile) => T | Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const t = await readTeam();
    const out = await fn(t);
    t.messages = t.messages.slice(-MAX_MESSAGES);
    await fsp.mkdir(path.dirname(FILE), { recursive: true });
    const tmp = `${FILE}.${process.pid}.${Date.now()}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(t, null, 2), "utf8");
    await fsp.rename(tmp, FILE);
    return out;
  });
  chain = run.catch(() => {});
  return run;
}

// ─── teammates ───

export interface MemberInput {
  id?: string;
  name?: string;
  role?: string;
  tool?: string;
  agent?: string;
  agentLabel?: string;
  host?: string;
  hostLabel?: string;
  folder?: string;
  project?: string;
  access?: string;
}

export async function saveMember(m: MemberInput): Promise<TeamMember> {
  const name = (m.name ?? "").trim();
  if (!NAME_RE.test(name)) throw new Error("A name is one word: letters, digits, - or _ (it is how you @mention them).");
  const role = (m.role ?? "").trim().slice(0, 2000);
  if (!role) throw new Error("Say what this teammate does (their role and instructions).");
  if (!isSessionTool(m.tool)) throw new Error("Pick a tool.");
  if (m.tool === "acp" && !m.agent) throw new Error("Pick which ACP agent.");
  const folder = (m.folder ?? "").trim();
  if (!folder) throw new Error("Pick a project folder (or the home folder).");
  const cfg = await readConfig().catch(() => null);
  const host = m.host || me();
  return mutate((t) => {
    if (t.members.some((x) => x.name.toLowerCase() === name.toLowerCase() && x.id !== m.id)) throw new Error(`There is already a teammate called ${name}.`);
    const old = m.id ? t.members.find((x) => x.id === m.id) : undefined;
    // a teammate moved to another tool, machine or folder starts a fresh session there
    const sameSeat = old && old.tool === m.tool && old.agent === m.agent && old.host === host && old.folder === folder;
    const member: TeamMember = {
      id: old?.id ?? newId("tm"),
      name,
      role,
      tool: m.tool as SessionTool,
      agent: m.tool === "acp" ? m.agent : undefined,
      agentLabel: m.tool === "acp" ? m.agentLabel || m.agent : undefined,
      host,
      hostLabel: host === me() ? cfg?.label || me() : m.hostLabel || host,
      folder,
      project: m.project || undefined,
      access: m.access === "edit" ? "edit" : "answer",
      sessionKey: sameSeat ? old?.sessionKey : undefined,
      createdAt: old?.createdAt ?? Date.now(),
    };
    if (old) Object.assign(old, member);
    else t.members.push(member);
    return member;
  });
}

export async function removeMember(id: string): Promise<void> {
  await mutate((t) => {
    t.members = t.members.filter((m) => m.id !== id);
  });
}

export async function clearChannel(): Promise<void> {
  await mutate((t) => {
    t.messages = t.messages.filter((m) => m.status === "waiting" || m.status === "working");
  });
}

/** Start the teammate over: its next message opens a new session (with the role again). */
export async function resetMember(id: string): Promise<void> {
  await mutate((t) => {
    const m = t.members.find((x) => x.id === id);
    if (m) m.sessionKey = undefined;
  });
}

// ─── messages ───

const firstLine = (s: string) => s.split(/\r?\n/).find((l) => l.trim())?.trim().slice(0, 120) ?? "";

function intro(member: TeamMember, team: TeamMember[]): string {
  const others = team.filter((m) => m.id !== member.id);
  return [
    `You are ${member.name}, one member of a small team of AI agents that a person runs from Mission Control. Each teammate works in its own session.`,
    `Your role:\n${member.role}`,
    others.length ? `Your teammates:\n${others.map((m) => `- ${m.name}: ${firstLine(m.role)}`).join("\n")}` : "You have no teammates yet.",
    `To hand work to a teammate, put a line at the END of your reply in exactly this form:\n@Name: what you need them to do\nOne line per hand-off, only when someone else really should do the next part. Finish your own part first. Don't hand work back and forth, and don't hand off just to report: the person reads every reply in the channel.`,
  ].join("\n\n");
}

const reminder = (member: TeamMember) => `(Team: you are ${member.name}. Hand work on with a final line "@Name: task" only when needed.)`;

async function sendTo(member: TeamMember, team: TeamMember[], text: string, fromLabel: string): Promise<SessionJob> {
  const body = `${fromLabel} says:\n${text}`;
  if (member.sessionKey) {
    const reply = (whenFree: boolean) =>
      startJob({ mode: "reply", key: member.sessionKey, host: member.host, folder: member.folder, prompt: `${reminder(member)}\n\n${body}`, access: member.access, whenFree, project: member.project });
    // held until the teammate's session is free; a machine on an older version can't hold it, so it goes now
    return reply(true).catch((e: Error) => (/can't hold a message/.test(e.message) ? reply(false) : Promise.reject(e)));
  }
  return startJob({
    mode: "new",
    host: member.host,
    folder: member.folder,
    tool: member.tool,
    agent: member.agent,
    project: member.project,
    prompt: `${intro(member, team)}\n\n---\n\n${body}`,
    access: member.access,
  });
}

/** You write in the channel. Every teammate @mentioned gets the message. */
export async function post(text: string): Promise<TeamMessage[]> {
  const msg = text.trim();
  if (!msg) throw new Error("Write a message first.");
  if (msg.length > 12_000) throw new Error("That message is too long.");
  const { members } = await readTeam();
  const to = mentions(msg, members);
  if (!to.length) throw new Error(members.length ? `Name a teammate with @, e.g. @${members[0].name}.` : "Add a teammate first.");
  const youMsg: TeamMessage = { id: newId("tmsg"), ts: Date.now(), from: "you", text: msg, hop: 0 };
  const sent: TeamMessage[] = [youMsg];
  for (const id of to) {
    const member = members.find((m) => m.id === id)!;
    try {
      const job = await sendTo(member, members, msg, "The person running the team");
      sent.push({ id: newId("tmsg"), ts: Date.now(), from: "system", to: id, jobId: job.id, status: job.status === "error" ? "error" : "waiting", text: job.status === "error" ? job.error ?? "failed" : "", hop: 0 });
    } catch (e) {
      sent.push({ id: newId("tmsg"), ts: Date.now(), from: "system", to: id, status: "error", text: `Couldn't reach ${member.name}: ${(e as Error).message}`, hop: 0 });
    }
  }
  await mutate((t) => void t.messages.push(...sent));
  return sent;
}

const ACTIVE = ["queued", "sent", "running"];

/**
 * Settle finished jobs into the channel and send the hand-offs they contain. Scheduler instance
 * only (see the header). A reply that names several teammates hands off to each.
 */
export async function teamTick(): Promise<void> {
  const team = await readTeam();
  if (!team.messages.some((m) => m.jobId && (m.status === "waiting" || m.status === "working"))) return;
  const jobs = await listJobs();
  const toSend: { member: TeamMember; text: string; fromLabel: string; hop: number }[] = [];
  const paused = isPaused();
  await mutate((t) => {
    for (const msg of t.messages) {
      if (!msg.jobId || (msg.status !== "waiting" && msg.status !== "working")) continue;
      const job = jobs.find((j) => j.id === msg.jobId);
      const member = t.members.find((m) => m.id === msg.to);
      if (!job || !member) {
        msg.status = "error";
        msg.text = job ? "That teammate was removed." : "The job behind this message is gone.";
        continue;
      }
      if (ACTIVE.includes(job.status)) {
        msg.status = job.status === "running" ? "working" : "waiting";
        msg.text = job.waitReason ? `waiting for ${job.waitReason}` : "";
        continue;
      }
      msg.status = job.status === "done" ? "done" : "error";
      msg.text = "";
      const fb = job.fellBack;
      // the teammate keeps its name and role on the tool that took over (OpenBot calls this "change the provider, keep the agent")
      if (job.status === "done" && fb && !fb.local) {
        const tool = toolOfKey(job.resultKey ?? "");
        if (tool) {
          member.tool = tool;
          if (tool === "acp") {
            const a = splitAcpId((job.resultKey ?? "").slice(4));
            member.agent = a?.agent;
            member.agentLabel = fb.toLabel;
          } else member.agent = member.agentLabel = undefined;
        }
        t.messages.push({ id: newId("tmsg"), ts: Date.now(), from: "system", text: `${member.name} now uses ${fb.toLabel} (${fb.fromLabel} hit its limit). Same role, the conversation carried over.`, hop: msg.hop });
      }
      if (job.status === "done" && job.resultKey && !fb?.local) member.sessionKey = job.resultKey;
      const reply = job.status === "done" ? job.reply ?? "" : `(${job.error ?? "failed"})`;
      t.messages.push({
        id: newId("tmsg"),
        ts: job.finishedAt ?? Date.now(),
        from: member.id,
        text: fb?.local ? `${reply}\n\n_(answered by the local model while ${fb.fromLabel} was at its limit; not saved in ${member.name}'s session)_` : reply,
        hop: msg.hop,
      });
      if (job.status !== "done") continue;
      for (const h of handoffs(reply, t.members, member.id)) {
        const target = t.members.find((m) => m.id === h.to)!;
        if (msg.hop + 1 > MAX_HOPS) {
          t.messages.push({ id: newId("tmsg"), ts: Date.now(), from: "system", status: "held", to: h.to, text: `Stopped after ${MAX_HOPS} hand-offs without you: ${member.name}'s hand-off to ${target.name} wasn't sent. Reply to carry on.`, hop: msg.hop + 1 });
        } else if (paused) {
          t.messages.push({ id: newId("tmsg"), ts: Date.now(), from: "system", status: "held", to: h.to, text: `The fleet is paused: ${member.name}'s hand-off to ${target.name} wasn't sent. Send it yourself if you want it.`, hop: msg.hop + 1 });
        } else toSend.push({ member: target, text: h.text, fromLabel: `Your teammate ${member.name}`, hop: msg.hop + 1 });
      }
    }
  });
  for (const s of toSend) {
    const fresh = await readTeam();
    const member = fresh.members.find((m) => m.id === s.member.id) ?? s.member;
    let note: TeamMessage;
    try {
      const job = await sendTo(member, fresh.members, s.text, s.fromLabel);
      note = { id: newId("tmsg"), ts: Date.now(), from: "system", to: member.id, jobId: job.id, status: "waiting", text: "", hop: s.hop };
    } catch (e) {
      note = { id: newId("tmsg"), ts: Date.now(), from: "system", to: member.id, status: "error", text: `Couldn't hand to ${member.name}: ${(e as Error).message}`, hop: s.hop };
    }
    await mutate((t) => void t.messages.push(note));
  }
}

export const memberToolLabel = (m: Pick<TeamMember, "tool" | "agentLabel">) => (m.tool === "acp" ? m.agentLabel || "ACP agent" : toolLabel(m.tool));
