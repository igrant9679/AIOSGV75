import { findContent, mdToHtml } from "@/lib/content";

export const dynamic = "force-dynamic";

/** GET ?id=&format=md|html — the article as downloadable Markdown or HTML. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id") ?? "";
  const format = url.searchParams.get("format") === "md" ? "md" : "html";
  const item = await findContent(id);
  if (!item) return new Response("not found", { status: 404 });

  if (format === "md") {
    const md = `# ${item.title}\n\n${item.bodyMarkdown}\n`;
    return new Response(md, {
      headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename="${item.slug}.md"` },
    });
  }
  const body = mdToHtml(item.bodyMarkdown);
  const html = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>${item.title}</title>\n<meta name="description" content="${item.metaDescription.replace(/"/g, "&quot;")}">\n</head>\n<body>\n<h1>${item.title}</h1>\n${body}\n</body>\n</html>`;
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
