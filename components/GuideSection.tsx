"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { GUIDE_SECTIONS } from "@/lib/guideContent";
import Panel from "./ui/Panel";
import Markdown from "./Markdown";

/** Score a section against the query: title > keywords > body. */
function matchScore(query: string, title: string, keywords: string, body: string): number {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return 1;
  let score = 0;
  for (const t of terms) {
    if (title.toLowerCase().includes(t)) score += 5;
    if (keywords.toLowerCase().includes(t)) score += 3;
    if (body.toLowerCase().includes(t)) score += 1;
  }
  return score;
}

export default function GuideSection() {
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const scored = GUIDE_SECTIONS.map((s) => ({
      ...s,
      score: matchScore(query, s.title, s.keywords, s.body),
    })).filter((s) => s.score > 0);
    return query.trim() ? scored.sort((a, b) => b.score - a.score) : scored;
  }, [query]);

  const scrollTo = (id: string) => {
    document.getElementById(`guide-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[240px_1fr]">
      {/* table of contents */}
      <div className="hidden xl:block">
        <Panel title="Contents" className="sticky top-4">
          <nav aria-label="Guide contents" className="flex flex-col gap-0.5 p-2">
            {results.map((s) => (
              <button
                key={s.id}
                onClick={() => scrollTo(s.id)}
                className="cursor-pointer rounded-lg px-3 py-1.5 text-left text-[12px] text-ink-dim transition-colors hover:bg-white/[0.04] hover:text-ink"
              >
                {s.title}
              </button>
            ))}
            {results.length === 0 && <p className="px-3 py-2 text-[11px] text-ink-faint">No matches.</p>}
          </nav>
        </Panel>
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        {/* search */}
        <Panel>
          <div className="flex flex-col gap-1.5 p-4">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the guide… (e.g. telegram, verbs, api key, watcher, embeddings)"
              aria-label="Search the user guide"
              autoFocus
              className="h-11 w-full rounded-xl border border-line bg-panel-2 px-4 text-[13.5px] text-ink outline-none placeholder:text-ink-faint focus:border-line-bright"
            />
            <p className="px-1 font-mono text-[10px] text-ink-faint" aria-live="polite">
              {query.trim()
                ? `${results.length} section${results.length === 1 ? "" : "s"} match — best matches first`
                : `${GUIDE_SECTIONS.length} sections · your agents can answer guide questions too (it lives in the vault)`}
            </p>
          </div>
        </Panel>

        {/* sections */}
        {results.map((s, i) => (
          <motion.div
            key={s.id}
            id={`guide-${s.id}`}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(i * 0.03, 0.2) }}
            className="scroll-mt-4"
          >
            <Panel title={s.title}>
              <div className="px-5 py-4">
                <Markdown>{s.body}</Markdown>
              </div>
            </Panel>
          </motion.div>
        ))}
        {results.length === 0 && (
          <Panel>
            <p className="p-8 text-center text-sm text-ink-faint">
              Nothing matches &ldquo;{query}&rdquo; — try a different word, or ask any agent: the guide is in their vault
              context.
            </p>
          </Panel>
        )}
      </div>
    </div>
  );
}
