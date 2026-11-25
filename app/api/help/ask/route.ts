import { GUIDE_SECTIONS } from "@/lib/guideContent";
import { HELP_INTRO, HOW_TO, GLOSSARY, helpForPath } from "@/lib/helpContent";
import { metaForPath } from "@/lib/accents";
import { runClaudeText } from "@/lib/runners";
import { productName } from "@/lib/netSettings";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

/**
 * Help → Ask: answer a question about the app from its own manual.
 *
 * Only the manual sections that match the question are sent (plus help for the
 * page the person is on), so the prompt stays small and the answer stays on
 * what the app really does. Claude Haiku on the subscription, no tools, no
 * session saved, no shared memory: this is a manual look-up, not a chat.
 */

const STOP = new Set("a an and are can do does for from how i in is it me my of on or the this to what when where which who why with you your".split(" "));

function terms(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
}

function score(ts: string[], title: string, keywords: string, body: string): number {
  const ti = title.toLowerCase();
  const kw = keywords.toLowerCase();
  const bo = body.toLowerCase();
  let s = 0;
  for (const t of ts) {
    if (ti.includes(t)) s += 6;
    if (kw.includes(t)) s += 4;
    if (bo.includes(t)) s += 1 + Math.min(4, bo.split(t).length - 2);
  }
  return s;
}

export async function POST(req: Request) {
  let b: { question?: unknown; path?: unknown };
  try {
    b = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  const question = typeof b.question === "string" ? b.question.trim().slice(0, 600) : "";
  const path = typeof b.path === "string" && /^\/[\w/-]{0,80}$/.test(b.path) ? b.path : "/";
  if (question.length < 3) return Response.json({ error: "Type a question first." }, { status: 400 });

  const ts = terms(question);
  const page = helpForPath(path);
  const sections = GUIDE_SECTIONS.map((s) => ({ s, n: score(ts, s.title, s.keywords, s.body) + (page?.guide?.includes(s.id) ? 3 : 0) }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, 4)
    .map((x) => x.s);
  const howto = HOW_TO.map((h) => ({ h, n: score(ts, h.q, "", h.a) }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, 5)
    .map((x) => x.h);
  const glossary = GLOSSARY.filter((g) => ts.some((t) => g.term.toLowerCase().includes(t)));

  const product = productName();
  const brand = (t: string) => (product === "Mission Control" ? t : t.split("Mission Control").join(product));
  const prompt = brand(
    [
      `You answer questions from someone who is new to Mission Control, a dashboard app on their own computer. Answer ONLY from the manual extracts below.`,
      `Rules:`,
      `- Plain, friendly language for a non-expert. Short: usually 3-8 sentences or a few numbered steps.`,
      `- Name the exact page (as it appears in the sidebar) and the buttons to click.`,
      `- If the extracts don't cover it, say so plainly and suggest searching the Guide page. Never invent buttons, pages or settings.`,
      `- Don't mention "extracts" or "the manual below"; just answer.`,
      ``,
      `They are on the page: ${metaForPath(path).title} (${path}).`,
      ``,
      `--- WHAT THE APP IS ---`,
      HELP_INTRO,
      ...(page ? [``, `--- THE PAGE THEY ARE ON ---`, page.what, ...(page.steps ?? []).flatMap((s) => [s.title + ":", ...s.items.map((i) => `- ${i}`)]), ...(page.tips ?? []).map((t) => `- ${t}`)] : []),
      ...(howto.length ? [``, `--- HOW-TO ANSWERS ---`, ...howto.map((h) => `Q: ${h.q}\nA: ${h.a}`)] : []),
      ...(glossary.length ? [``, `--- TERMS ---`, ...glossary.map((g) => `${g.term}: ${g.def}`)] : []),
      ...(sections.length ? [``, `--- MANUAL SECTIONS ---`, ...sections.map((s) => `## ${s.title}\n${s.body}`)] : []),
      ``,
      `QUESTION: ${question}`,
    ].join("\n"),
  );

  const r = await runClaudeText(prompt, ["--model", "haiku", "--no-session-persistence", "--disallowedTools", "Bash,PowerShell,Edit,Write,MultiEdit,NotebookEdit,Read,Glob,Grep,WebFetch,WebSearch,Task"]);
  if (r.error || !r.text.trim()) {
    const why = r.error ?? "no answer";
    const signedOut = /login|auth|401|credential/i.test(why);
    return Response.json(
      {
        error: signedOut
          ? "Claude Code isn't signed in on this computer, so it can't answer. Open a terminal, run claude, and type /login. Meanwhile the How do I… tab and the Guide have the answers."
          : `Couldn't get an answer (${why.slice(0, 160)}). Try the How do I… tab or search the Guide.`,
        sections: sections.map((s) => ({ id: s.id, title: brand(s.title) })),
      },
      { status: 502 },
    );
  }
  return Response.json({ answer: r.text.trim(), sections: sections.map((s) => ({ id: s.id, title: brand(s.title) })) });
}
