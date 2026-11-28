import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { vaultAvailable, vaultInfo } from "./vault";
import { BUILTIN_TOOLS, cleanTool, fillTool, type LibraryTool } from "./toolRules";

/**
 * The Tools library (/tools, rule 52): short forms that produce a finished piece of writing.
 *   - built-in tools and the owner's own (kept in the vault, Cluster/tools.json, so every machine has them):
 *     a form is filled into a prompt (lib/toolRules.ts) and answered by a model (Auto, or the engine picked)
 *   - every Claude skill on this machine (~/.claude/skills): one box, run as a Claude Code session here,
 *     answer only, so the skill's own instructions and files are used
 * Results are saved on this machine (data/tool-results.json, the newest 60): only the owner sees them.
 */

const DATA = path.join(process.cwd(), "data");
const RESULTS = path.join(DATA, "tool-results.json");
const toolsFile = () => path.join(vaultInfo().base, "Cluster", "tools.json");

export interface ToolResult { id: string; toolId: string; toolName: string; at: number; engine?: string; input: string; text: string; jobId?: string; status: "done" | "running" | "failed" }
export interface SkillInfo { name: string; description: string }

export function readCustomTools(): LibraryTool[] {
  try {
    const j = JSON.parse(fs.readFileSync(toolsFile(), "utf8"));
    return Array.isArray(j?.tools) ? j.tools : [];
  } catch {
    return [];
  }
}
async function writeCustomTools(tools: LibraryTool[]) {
  if (!(await vaultAvailable())) throw new Error("The vault isn't available on this machine.");
  const f = toolsFile();
  await fsp.mkdir(path.dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify({ v: 1, tools }, null, 1), "utf8");
  for (let i = 0; ; i++) {
    try {
      await fsp.rename(tmp, f);
      return;
    } catch (e) {
      if (i >= 8) throw e;
      await new Promise((r) => setTimeout(r, 250 * (i + 1)));
    }
  }
}
export const allTools = (): LibraryTool[] => [...BUILTIN_TOOLS, ...readCustomTools()];
export async function saveCustomTool(raw: unknown): Promise<LibraryTool> {
  const t = cleanTool(raw);
  const list = readCustomTools();
  const i = list.findIndex((x) => x.id === t.id);
  if (i >= 0) list[i] = t;
  else list.push(t);
  await writeCustomTools(list);
  return t;
}
export async function deleteCustomTool(id: string): Promise<void> {
  await writeCustomTools(readCustomTools().filter((t) => t.id !== id));
}

/** The Claude skills on this machine: name and the description from each SKILL.md's front matter. */
export function localSkills(): SkillInfo[] {
  const root = path.join(os.homedir(), ".claude", "skills");
  const out: SkillInfo[] = [];
  try {
    for (const d of fs.readdirSync(root)) {
      const f = path.join(root, d, "SKILL.md");
      if (!fs.existsSync(f)) continue;
      const head = fs.readFileSync(f, "utf8").slice(0, 4000);
      const m = /^description:\s*(?:"([\s\S]*?)"|'([\s\S]*?)'|(.*))$/m.exec(head);
      out.push({ name: d, description: (m?.[1] ?? m?.[2] ?? m?.[3] ?? "").replace(/\s+/g, " ").trim().slice(0, 260) });
    }
  } catch {
    /* no skills folder */
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function readResults(): Promise<ToolResult[]> {
  try {
    const j = JSON.parse(await fsp.readFile(RESULTS, "utf8"));
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}
let chain: Promise<unknown> = Promise.resolve();
function mutateResults<T>(fn: (r: ToolResult[]) => T): Promise<T> {
  const run = chain.then(async () => {
    const list = await readResults();
    const out = fn(list);
    await fsp.mkdir(DATA, { recursive: true });
    const tmp = `${RESULTS}.${process.pid}.${Date.now()}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(list.slice(0, 60)), "utf8");
    await fsp.rename(tmp, RESULTS);
    return out;
  });
  chain = run.catch(() => {});
  return run;
}
export const deleteResult = (id: string) => mutateResults((l) => void l.splice(0, l.length, ...l.filter((r) => r.id !== id)));

/** Run a form tool: fill the prompt, ask the engine, keep the result. */
export async function runTool(id: string, values: Record<string, unknown>, engine?: string): Promise<ToolResult> {
  const tool = allTools().find((t) => t.id === id);
  if (!tool) throw new Error("That tool isn't in the library any more.");
  const filled = fillTool(tool, values);
  if ("error" in filled) throw new Error(filled.error);
  const { runAgentText } = await import("./runners");
  const agent = engine && /^[\w.-]{1,60}$/.test(engine) ? engine : tool.engine || "auto";
  const r = await runAgentText(agent, filled.prompt, { injectMemory: true });
  if (r.error && !r.text) throw new Error(r.error.slice(0, 300));
  const result: ToolResult = { id: `tr-${Date.now().toString(36)}`, toolId: tool.id, toolName: tool.name, at: Date.now(), engine: r.routedTo ?? agent, input: Object.values(values ?? {}).map((v) => String(v ?? "")).join(" · ").slice(0, 300), text: r.text, status: "done" };
  await mutateResults((l) => void l.unshift(result));
  return result;
}

/** Run a skill: a Claude Code session on this machine, answer only, told to use that skill. */
export async function runSkill(name: string, input: string): Promise<ToolResult> {
  if (!localSkills().some((s) => s.name === name)) throw new Error("That skill isn't on this machine.");
  const ask = String(input ?? "").trim().slice(0, 8000);
  if (!ask) throw new Error("Say what you need from it.");
  const { startJob } = await import("./sessionActions");
  const job = await startJob({ mode: "new", host: os.hostname(), folder: "~", tool: "claude", access: "answer", project: "Tools", dispatch: `Tool · ${name}`, prompt: `Use your "${name}" skill for this request, and give the finished result in your reply (don't change any files).\n\n${ask}` });
  if (job.status === "error") throw new Error(job.error ?? "It couldn't be started.");
  const result: ToolResult = { id: `tr-${Date.now().toString(36)}`, toolId: `skill:${name}`, toolName: name, at: Date.now(), engine: "Claude Code", input: ask.slice(0, 300), text: "", jobId: job.id, status: "running" };
  await mutateResults((l) => void l.unshift(result));
  return result;
}

/** Fill in the results of skill runs that have finished (called when the page asks). */
export async function settleResults(): Promise<ToolResult[]> {
  const list = await readResults();
  if (!list.some((r) => r.status === "running" && r.jobId)) return list;
  const { listJobs } = await import("./sessionActions");
  const jobs = await listJobs();
  return mutateResults((l) => {
    for (const r of l) {
      if (r.status !== "running" || !r.jobId) continue;
      const j = jobs.find((x) => x.id === r.jobId);
      if (!j) {
        if (Date.now() - r.at > 30 * 60_000) Object.assign(r, { status: "failed", text: "Its run disappeared." });
      } else if (j.status === "done") Object.assign(r, { status: "done", text: String(j.reply ?? "") });
      else if (j.status === "error" || j.status === "expired") Object.assign(r, { status: "failed", text: String(j.error ?? j.status) });
    }
    return [...l];
  });
}
