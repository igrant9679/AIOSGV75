import fs from "fs/promises";
import path from "path";
import { runAgentText } from "./runners";
import { startOrchestration, listOrchestrations } from "./orchestrator";
import { appendJournalEntry, vaultInfo, vaultAvailable, todayStamp } from "./vault";

/**
 * From Inbox to Shipped: capture a raw idea, agents classify + route it, you
 * approve once, then it's built and filed. One human checkpoint; everything
 * else is agents. Stages:
 *   capture  → just landed, unclassified
 *   classify → Claude sorts it: type · confidence · title · tags · plan
 *   gate     → projects/escalations wait for your Approve (the one checkpoint)
 *   execute  → an Orchestration builds the deliverable
 *   shipped  → done and filed to the vault
 * Small items (action/idea/reference) skip the gate and file straight away.
 */
export type PipelineStage = "capture" | "classify" | "gate" | "execute" | "shipped" | "rejected";
export type ItemType = "project" | "action" | "idea" | "reference" | "escalate";

export interface PipelineItem {
  id: string;
  input: string;
  stage: PipelineStage;
  type?: ItemType;
  confidence?: number;
  title: string;
  tags: string[];
  plan?: string;
  orchestrationId?: string;
  result?: string;
  vaultFile?: string;
  createdAt: number;
  updatedAt: number;
}

const FILE = path.join(process.cwd(), "data", "pipeline.json");
const MAX_ITEMS = 200;
const GATED: ItemType[] = ["project", "escalate"];

async function readDisk(): Promise<PipelineItem[]> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8")) as PipelineItem[];
  } catch {
    return [];
  }
}

async function writeDisk(items: PipelineItem[]): Promise<void> {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(items.slice(0, MAX_ITEMS), null, 2), "utf8");
}

async function update(id: string, patch: Partial<PipelineItem>): Promise<PipelineItem | null> {
  const items = await readDisk();
  const item = items.find((i) => i.id === id);
  if (!item) return null;
  Object.assign(item, patch, { updatedAt: Date.now() });
  await writeDisk(items);
  return item;
}

function extractJson<T>(text: string): T | null {
  const m = text.replace(/```(?:json)?/gi, "").match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as T;
  } catch {
    return null;
  }
}

function classifyPrompt(input: string): string {
  return [
    `You are the inbox classifier in an agent pipeline. Sort this captured idea.`,
    ``,
    `IDEA: ${input}`,
    ``,
    `Classify into exactly one type:`,
    `- project: a buildable deliverable (a tool, app, document, campaign) → will be built by agents`,
    `- action: a small concrete to-do for the human`,
    `- idea: a thought worth keeping but not acting on yet`,
    `- reference: information to file for later`,
    `- escalate: important/ambiguous, needs a human decision`,
    ``,
    `Return ONLY JSON: {"type": "...", "confidence": 0-100, "title": "short name", "tags": ["#tag", ...], "plan": "if project/escalate: one-sentence description of what to build; else empty"}`,
  ].join("\n");
}

let seq = 0;

/** Capture an idea and kick off classification (fire-and-forget). */
export async function capture(input: string): Promise<PipelineItem> {
  const items = await readDisk();
  const item: PipelineItem = {
    id: `pl-${Date.now().toString(36)}-${seq++}`,
    input: input.trim().slice(0, 4000),
    stage: "classify",
    title: input.trim().slice(0, 60),
    tags: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  items.unshift(item);
  await writeDisk(items);

  void (async () => {
    const r = await runAgentText("claude", classifyPrompt(item.input), { injectMemory: true });
    const parsed = r.error ? null : extractJson<{ type?: ItemType; confidence?: number; title?: string; tags?: string[]; plan?: string }>(r.text);
    const type = (parsed?.type ?? "idea") as ItemType;
    const gated = GATED.includes(type);
    await update(item.id, {
      type,
      confidence: Math.min(100, Math.max(0, Math.round(parsed?.confidence ?? 50))),
      title: (parsed?.title || item.title).slice(0, 80),
      tags: (parsed?.tags ?? []).slice(0, 4),
      plan: parsed?.plan?.slice(0, 500),
      stage: gated ? "gate" : "shipped",
    });
    // small items file straight to the vault
    if (!gated) await fileToVault(item.id).catch(() => {});
  })();

  return item;
}

/** Approve a gated item → launch an Orchestration to build it. */
export async function approve(id: string): Promise<PipelineItem | null> {
  const items = await readDisk();
  const item = items.find((i) => i.id === id);
  if (!item || item.stage !== "gate") return item ?? null;
  const orch = await startOrchestration(item.plan || item.input);
  return update(id, { stage: "execute", orchestrationId: orch.id });
}

export async function reject(id: string): Promise<PipelineItem | null> {
  return update(id, { stage: "rejected" });
}

export async function remove(id: string): Promise<void> {
  await writeDisk((await readDisk()).filter((i) => i.id !== id));
}

async function fileToVault(id: string): Promise<void> {
  const item = (await readDisk()).find((i) => i.id === id);
  if (!item) return;
  await appendJournalEntry(`📥 Pipeline · ${item.type}: **${item.title}** — ${item.input}`.slice(0, 600), "pipeline").catch(() => {});
}

async function archiveShipped(item: PipelineItem): Promise<string | undefined> {
  if (!(await vaultAvailable())) return undefined;
  try {
    const dir = path.join(vaultInfo().base, "Pipeline");
    await fs.mkdir(dir, { recursive: true });
    const slug = item.title.replace(/[^a-z0-9 ]/gi, "").trim().replace(/\s+/g, "-").toLowerCase().slice(0, 40) || "item";
    const file = path.join(dir, `${todayStamp()}-${slug}.md`);
    await fs.writeFile(
      file,
      [`# ${item.title}`, ``, `#agentic-os/pipeline · [[Agentic OS/Home|Agentic OS]] · ${item.type} · ${item.confidence}%`, ``, `**Captured:** ${item.input}`, ``, `## Deliverable`, ``, item.result ?? "_(no result)_", ``].join("\n"),
      "utf8"
    );
    return path.relative(vaultInfo().root, file).replace(/\\/g, "/");
  } catch {
    return undefined;
  }
}

/**
 * Advance any executing items whose Orchestration has finished. Called on
 * list() and by the scheduler tick so the board self-updates.
 */
export async function syncExecuting(): Promise<void> {
  const items = await readDisk();
  const executing = items.filter((i) => i.stage === "execute" && i.orchestrationId);
  if (executing.length === 0) return;
  const orchs = await listOrchestrations();
  let dirty = false;
  for (const item of executing) {
    const orch = orchs.find((o) => o.id === item.orchestrationId);
    if (!orch) continue;
    if (orch.status === "done") {
      item.result = orch.final ?? "(assembled — see mission archive)";
      item.stage = "shipped";
      item.updatedAt = Date.now();
      item.vaultFile = orch.vaultFile ?? (await archiveShipped(item));
      dirty = true;
    } else if (orch.status === "error") {
      item.result = `build failed: ${orch.error ?? "unknown"}`;
      item.stage = "gate"; // back to the human
      item.updatedAt = Date.now();
      dirty = true;
    }
  }
  if (dirty) await writeDisk(items);
}

export async function listItems(): Promise<PipelineItem[]> {
  await syncExecuting().catch(() => {});
  return readDisk();
}
