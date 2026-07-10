import { readJournal, writeJournal, todayStamp, vaultAvailable, DATE_RE, ensureAgentPage } from "@/lib/vault";
import { agentWikilink } from "@/lib/chatMarkdown";
import { WORKSPACE_RE } from "@/lib/registry";

export const dynamic = "force-dynamic";

function wsParam(value: string | null | undefined): string | undefined {
  if (!value || value === "Default") return undefined;
  return WORKSPACE_RE.test(value) ? value : undefined;
}

export async function GET(request: Request) {
  if (!(await vaultAvailable())) return Response.json({ error: "vault not reachable" }, { status: 503 });
  const url = new URL(request.url);
  const date = url.searchParams.get("date") ?? todayStamp();
  if (!DATE_RE.test(date)) return Response.json({ error: "bad date" }, { status: 400 });
  const ws = wsParam(url.searchParams.get("workspace"));
  const { content, dates } = await readJournal(date, ws);
  return Response.json({ date, content, dates, today: todayStamp() });
}

/** Append a timestamped entry to today's journal (used by OS verbs). */
export async function POST(request: Request) {
  const body = (await request.json()) as { entry?: string; source?: string; workspace?: string };
  const entry = (body.entry ?? "").toString().trim();
  if (!entry) return Response.json({ error: "entry required" }, { status: 400 });
  if (entry.length > 5000) return Response.json({ error: "too large" }, { status: 413 });
  if (!(await vaultAvailable())) return Response.json({ error: "vault not reachable" }, { status: 503 });

  const ws = wsParam(body.workspace);
  const date = todayStamp();
  const { content } = await readJournal(date, ws);
  const d = new Date();
  const stamp = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const source = (body.source ?? "agent").toString().slice(0, 30);
  await ensureAgentPage(source).catch(() => {});
  const line = `**${stamp} · ${agentWikilink(source)}:** ${entry}`;
  await writeJournal(date, content ? `${content.replace(/\s+$/, "")}\n\n${line}\n` : `${line}\n`, ws);
  return Response.json({ ok: true });
}

export async function PUT(request: Request) {
  const body = (await request.json()) as { date?: string; content?: string; workspace?: string };
  const date = body.date ?? todayStamp();
  const content = (body.content ?? "").toString();
  if (!DATE_RE.test(date)) return Response.json({ error: "bad date" }, { status: 400 });
  if (content.length > 1_000_000) return Response.json({ error: "too large" }, { status: 413 });
  if (!(await vaultAvailable())) return Response.json({ error: "vault not reachable" }, { status: 503 });

  await writeJournal(date, content, wsParam(body.workspace));
  return Response.json({ ok: true });
}
