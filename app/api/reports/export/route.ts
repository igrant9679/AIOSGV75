import { buildReport, reportMarkdown } from "@/lib/reports";
import { mdToHtml } from "@/lib/content";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET ?id=&format=md|html — download a freshly built report as a file. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id") ?? "";
  const format = url.searchParams.get("format") === "html" ? "html" : "md";
  const report = await buildReport(id);
  if (!report) return Response.json({ error: "unknown report" }, { status: 404 });
  const md = reportMarkdown(report);
  const stamp = new Date().toISOString().slice(0, 10);
  const base = `${report.title.replace(/[^\w-]+/g, "-")}-${stamp}`;

  if (format === "md") {
    return new Response(md, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${base}.md"`,
      },
    });
  }

  // Self-contained printable HTML (print → PDF from the browser).
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${report.title}</title>
<style>
  body{font-family:ui-sans-serif,system-ui,sans-serif;max-width:860px;margin:2rem auto;padding:0 1.5rem;color:#1b2238;line-height:1.6}
  h1{border-bottom:3px solid #0e7490;padding-bottom:.4rem}
  h2{color:#0e7490;margin-top:1.6em}
  table{border-collapse:collapse;width:100%;font-size:14px;margin:.6em 0}
  th,td{border:1px solid #cdd3e4;padding:.35em .7em;text-align:left}
  th{background:#eef1f9;font-size:12px;text-transform:uppercase;letter-spacing:.06em}
  code{background:#eef1f9;padding:.1em .3em;border-radius:4px;font-size:.9em}
  em{color:#4b5474}
  @media print{body{margin:0}}
</style></head><body>${mdToHtml(md.replace(/^---[\s\S]*?---\n/, ""))}</body></html>`;
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename="${base}.html"`,
    },
  });
}
