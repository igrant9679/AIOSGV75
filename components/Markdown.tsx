"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Obsidian vault name for obsidian:// deep links (folder that holds .obsidian). */
const VAULT_NAME = "IdrisGV75";

/** Convert [[wikilinks]] to obsidian:// deep links so they open the vault. */
function preprocessWikilinks(text: string): string {
  return text.replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_m, target: string, label?: string) => {
    const t = target.trim();
    const name = (label?.trim() || t.split("/").pop() || t).trim();
    return `[${name}](obsidian://open?vault=${encodeURIComponent(VAULT_NAME)}&file=${encodeURIComponent(t)})`;
  });
}

/** Safe, themed markdown renderer for agent output. Raw HTML is never rendered. */
export default function Markdown({ children }: { children: string }) {
  return (
    <div className="md-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) => (/^(https?:|obsidian:|mailto:)/i.test(url) ? url : "")}
        components={{
          a: ({ href, children: kids }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {kids}
            </a>
          ),
        }}
      >
        {preprocessWikilinks(children)}
      </ReactMarkdown>
    </div>
  );
}
