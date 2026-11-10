"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useObsidianVault } from "./useNetSettings";

/** Convert [[wikilinks]] to obsidian:// deep links so they open the vault (named after its folder). */
function preprocessWikilinks(text: string, vault: string): string {
  return text.replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_m, target: string, label?: string) => {
    const t = target.trim();
    const name = (label?.trim() || t.split("/").pop() || t).trim();
    return `[${name}](obsidian://open?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(t)})`;
  });
}

/** Safe, themed markdown renderer for agent output. Raw HTML is never rendered. */
export default function Markdown({ children }: { children: string }) {
  const vault = useObsidianVault();
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
        {preprocessWikilinks(children, vault)}
      </ReactMarkdown>
    </div>
  );
}
