/**
 * The Tools library, the pure parts (rule 52; tested by scripts/test-tools.mjs): what a tool is, the
 * built-in tools, and how a filled-in form becomes a prompt.
 */

export interface ToolField { key: string; label: string; placeholder?: string; long?: boolean; required?: boolean; options?: string[] }
export interface LibraryTool {
  id: string;
  name: string;
  category: string;
  /** one line: what you get */
  blurb: string;
  fields: ToolField[];
  /** the prompt, with {key} where each field's answer goes */
  prompt: string;
  /** the engine it runs best on ("auto" = Mission Control picks) */
  engine: string;
  builtin?: boolean;
}

const clip = (s: unknown, n: number) => String(s ?? "").replace(/\u0000/g, "").trim().slice(0, n);

/** A filled-in form → the prompt. Missing required answers are reported; the answers are fenced as the owner's input. */
export function fillTool(tool: LibraryTool, values: Record<string, unknown>): { prompt: string } | { error: string } {
  const missing = tool.fields.filter((f) => f.required && !clip(values?.[f.key], 20000)).map((f) => f.label);
  if (missing.length) return { error: `Fill in: ${missing.join(", ")}` };
  let p = tool.prompt;
  for (const f of tool.fields) p = p.split(`{${f.key}}`).join(clip(values?.[f.key], 20000) || "(not given)");
  return { prompt: `${p}\n\nWrite the finished result only, in clean Markdown, ready to use. No preamble.` };
}

/** Keep an owner-made tool's shape sane. Throws with a readable message. */
export function cleanTool(raw: any, now = Date.now()): LibraryTool {
  const name = clip(raw?.name, 60);
  if (!name) throw new Error("Give the tool a name.");
  const prompt = clip(raw?.prompt, 8000);
  if (prompt.length < 20) throw new Error("Write the prompt the tool runs (use {name} where an answer goes).");
  const fields: ToolField[] = (Array.isArray(raw?.fields) ? raw.fields : [])
    .slice(0, 12)
    .map((f: any) => ({ key: clip(f?.key, 30).replace(/[^A-Za-z0-9_]/g, ""), label: clip(f?.label, 60), placeholder: clip(f?.placeholder, 160) || undefined, long: f?.long === true, required: f?.required === true }))
    .filter((f: ToolField) => f.key && f.label);
  // any {key} in the prompt that has no field gets one, so the form always matches the prompt
  for (const m of prompt.matchAll(/\{([A-Za-z0-9_]{1,30})\}/g)) if (!fields.some((f) => f.key === m[1])) fields.push({ key: m[1], label: m[1].replace(/_/g, " "), required: true });
  return { id: typeof raw?.id === "string" && /^tool-[a-z0-9-]+$/.test(raw.id) ? raw.id : `tool-${now.toString(36)}`, name, category: clip(raw?.category, 30) || "Mine", blurb: clip(raw?.blurb, 200), fields, prompt, engine: clip(raw?.engine, 40) || "auto" };
}

export const BUILTIN_TOOLS: LibraryTool[] = [
  { id: "b-brief", builtin: true, name: "Project brief", category: "Planning", engine: "auto", blurb: "Turns a rough idea into a one-page brief: goal, scope, steps, risks, what done looks like.", fields: [{ key: "idea", label: "The idea, in your own words", long: true, required: true }, { key: "for_whom", label: "Who it is for", placeholder: "a client, a team, yourself" }, { key: "deadline", label: "Deadline or time available" }], prompt: "Write a one-page project brief.\n\nThe idea:\n{idea}\n\nWho it is for: {for_whom}\nDeadline or time available: {deadline}\n\nSections: Goal (one sentence), Why it matters, In scope, Out of scope, Steps in order with a rough size each, Risks and how to lower them, What done looks like." },
  { id: "b-email", builtin: true, name: "Email writer", category: "Writing", engine: "auto", blurb: "A ready-to-send email in your voice, with a shorter alternative.", fields: [{ key: "to", label: "Who it is to, and your relationship", required: true }, { key: "point", label: "What you need to say or ask", long: true, required: true }, { key: "tone", label: "Tone", options: ["Warm and direct", "Formal", "Brief and friendly", "Firm"] }], prompt: "Write an email.\n\nTo: {to}\nWhat it must say or ask:\n{point}\nTone: {tone}\n\nGive a subject line and the email, then a shorter alternative under the heading Shorter." },
  { id: "b-proposal", builtin: true, name: "Proposal writer", category: "Clients", engine: "auto", blurb: "Call notes into a client-ready proposal: scope, timeline, pricing table, next step.", fields: [{ key: "client", label: "Client and what they do", required: true }, { key: "notes", label: "Your notes from the call", long: true, required: true }, { key: "price", label: "Price or range" }], prompt: "Write a client proposal.\n\nClient: {client}\nNotes from the call:\n{notes}\nPrice or range: {price}\n\nSections: What we heard, What we will do (scope), Timeline, Investment (a small table), What we need from you, Next step." },
  { id: "b-meeting", builtin: true, name: "Meeting notes to actions", category: "Planning", engine: "auto", blurb: "Raw notes or a transcript into decisions, action items with owners, and open questions.", fields: [{ key: "notes", label: "Notes or transcript", long: true, required: true }], prompt: "From these meeting notes, write: Decisions made, Action items (a table: what, who, by when), Open questions, and a three-line summary.\n\nNotes:\n{notes}" },
  { id: "b-research", builtin: true, name: "Research brief", category: "Research", engine: "auto", blurb: "A structured answer to a question: the answer first, the evidence, what is still uncertain.", fields: [{ key: "question", label: "The question", long: true, required: true }, { key: "context", label: "What you already know or have ruled out", long: true }], prompt: "Research brief.\n\nQuestion:\n{question}\n\nAlready known or ruled out:\n{context}\n\nGive: the answer in two sentences, the reasoning and evidence, what would change the answer, and what is still uncertain. Say clearly when you are not sure." },
  { id: "b-social", builtin: true, name: "Social post set", category: "Content", engine: "auto", blurb: "One idea into posts for LinkedIn, X and a short video script, each with its own hook.", fields: [{ key: "idea", label: "The idea or announcement", long: true, required: true }, { key: "brand", label: "Brand or voice", placeholder: "LSI Media, MeYouSocial, personal" }], prompt: "Turn this into a social post set.\n\nIdea:\n{idea}\nBrand or voice: {brand}\n\nWrite: a LinkedIn post (under 180 words), three short posts for X, and a 30-second video script with a different hook. No hashtags unless they help." },
  { id: "b-sop", builtin: true, name: "Process to checklist", category: "Planning", engine: "auto", blurb: "A messy description of how something is done into a clean, numbered checklist someone else can follow.", fields: [{ key: "process", label: "How it is done today", long: true, required: true }, { key: "who", label: "Who will follow it" }], prompt: "Turn this into a checklist someone else can follow without asking questions.\n\nHow it is done today:\n{process}\nWho will follow it: {who}\n\nGive: what you need before starting, numbered steps (one action each), how to check it worked, and what to do when it goes wrong." },
  { id: "b-review", builtin: true, name: "Second opinion", category: "Research", engine: "auto", blurb: "A frank review of a plan, draft or decision: what is strong, what is weak, what to change first.", fields: [{ key: "thing", label: "The plan, draft or decision", long: true, required: true }, { key: "goal", label: "What it is meant to achieve" }], prompt: "Give a frank second opinion.\n\nThe plan, draft or decision:\n{thing}\n\nWhat it is meant to achieve: {goal}\n\nSay: what is strong, what is weak or risky, what is missing, and the three changes to make first. Be direct." },
];
