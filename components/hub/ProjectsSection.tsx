"use client";

import { useEffect, useMemo, useState } from "react";
import Panel from "../ui/Panel";
import EmptyState from "../ui/EmptyState";
import Markdown from "../Markdown";
import type { SessionSummary } from "@/lib/sessions";
import { useHub, SourcePill, StatusDot, HubError, IndexingNote, ago, fmtTokens } from "./common";

interface Passage {
  file: string;
  text: string;
  score: number;
}

interface ProjectGroup {
  name: string;
  sessions: SessionSummary[];
  updatedAt: number;
  tools: Set<string>;
  hosts: Set<string>;
  tokens: number;
}

/**
 * Projects — the brain organized by what you were working on rather than by
 * tool: every session in a folder, from any tool, plus the memories and vault
 * notes that mention it.
 */
export default function ProjectsSection() {
  const { hub, error } = useHub(30_000);
  const [selected, setSelected] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Passage[] | null>(null);
  const [searching, setSearching] = useState(false);

  const projects = useMemo<ProjectGroup[]>(() => {
    const map = new Map<string, ProjectGroup>();
    for (const s of hub?.sessions ?? []) {
      if (s.indexing) continue;
      const g = map.get(s.project) ?? { name: s.project, sessions: [], updatedAt: 0, tools: new Set(), hosts: new Set(), tokens: 0 };
      g.sessions.push(s);
      g.updatedAt = Math.max(g.updatedAt, s.updatedAt);
      g.tools.add(s.tool);
      g.hosts.add(s.host);
      g.tokens += s.tokensIn + s.tokensOut;
      map.set(s.project, g);
    }
    return [...map.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }, [hub]);

  const current = projects.find((p) => p.name === selected) ?? projects[0];

  useEffect(() => {
    setHits(null);
    setQ("");
  }, [current?.name]);

  const memories = useMemo(() => {
    if (!current || !hub) return [];
    const needle = current.name.toLowerCase();
    if (needle.length < 3) return [];
    return hub.memory.filter((m) => m.text.toLowerCase().includes(needle)).slice(0, 8);
  }, [hub, current]);

  const ask = async () => {
    if (!current) return;
    setSearching(true);
    try {
      const query = `${current.name} ${q}`.trim();
      const res = await fetch(`/api/vault/search?q=${encodeURIComponent(query)}`);
      const body = (await res.json()) as { results?: Passage[]; error?: string };
      setHits(body.results ?? []);
    } catch {
      setHits([]);
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <HubError error={error} />
      <IndexingNote hub={hub} />
      <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        <Panel title={`Projects · ${projects.length}`}>
          <div className="flex max-h-[70vh] flex-col gap-1 overflow-y-auto p-2">
            {hub && projects.length === 0 && <EmptyState accent="cyan" title="No sessions yet" compact />}
            {projects.map((p) => {
              const active = p.name === current?.name;
              return (
                <button
                  key={p.name}
                  type="button"
                  onClick={() => setSelected(p.name)}
                  className="flex cursor-pointer items-center justify-between gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-white/[0.04]"
                  style={active ? { background: "color-mix(in srgb, var(--page-accent) 14%, transparent)" } : undefined}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-semibold" style={{ color: active ? "var(--page-accent)" : "var(--color-ink)" }}>
                      {p.name}
                    </span>
                    <span className="block font-mono text-[10px] text-ink-faint">{ago(p.updatedAt)} ago</span>
                  </span>
                  <span className="font-mono text-[10px] text-ink-faint">{p.sessions.length}</span>
                </button>
              );
            })}
          </div>
        </Panel>

        {current ? (
          <div className="flex min-w-0 flex-col gap-4">
            <div className="panel px-5 py-4">
              <h3 className="font-display text-lg font-bold" style={{ color: "var(--page-accent)" }}>
                {current.name}
              </h3>
              <p className="pt-1 font-mono text-[11px] text-ink-faint">
                Last touched {ago(current.updatedAt)} ago · {[...current.hosts].join(", ")} · {current.sessions.length} sessions ·{" "}
                {fmtTokens(current.tokens)} tokens
              </p>
              <p className="truncate pt-0.5 font-mono text-[10px] text-ink-faint">{current.sessions[0]?.cwd}</p>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <Panel title="Sessions across tools">
                <div className="flex flex-col p-4">
                  {current.sessions.slice(0, 12).map((s) => (
                    <div key={s.key} className="flex items-center gap-2 border-b border-line py-2 last:border-b-0">
                      <StatusDot status={s.status === "ended" ? "done" : s.status} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-semibold text-ink">{s.title}</span>
                        <span className="block truncate font-mono text-[10px] text-ink-faint">
                          {ago(s.updatedAt)} ago · {s.userTurns} prompts · {fmtTokens(s.tokensIn + s.tokensOut)} tokens
                        </span>
                      </span>
                      <SourcePill source={s.tool} />
                    </div>
                  ))}
                  {current.sessions.length > 12 && (
                    <p className="pt-2 text-center font-mono text-[10px] text-ink-faint">+{current.sessions.length - 12} older</p>
                  )}
                </div>
              </Panel>

              <Panel title="Memory and decisions">
                <div className="flex flex-col p-4">
                  {memories.length === 0 && (
                    <EmptyState
                      accent="violet"
                      title="No memories yet"
                      hint={`Nothing in shared memory mentions “${current.name}” yet. Facts saved with <remember> that name the project show up here.`}
                      compact
                    />
                  )}
                  {memories.map((m) => (
                    <div key={`${m.ts}-${m.text.slice(0, 16)}`} className="border-b border-line py-2 last:border-b-0">
                      <p className="text-xs text-ink">{m.text}</p>
                      <p className="font-mono text-[10px] text-ink-faint">
                        {m.source} · {ago(m.ts)} ago
                      </p>
                    </div>
                  ))}
                </div>
              </Panel>
            </div>

            <Panel title="Ask the vault about this project">
              <div className="flex flex-col gap-3 p-4">
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    ask();
                  }}
                >
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder={`What do my notes say about ${current.name}?`}
                    aria-label="Search the vault for this project"
                    className="min-w-0 flex-1 rounded-lg border border-line bg-transparent px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-line-bright"
                  />
                  <button
                    type="submit"
                    disabled={searching}
                    className="cursor-pointer rounded-lg border border-line px-3 py-2 font-mono text-[11px] text-ink-dim transition-colors hover:bg-white/[0.06]"
                  >
                    {searching ? "Searching…" : "Search"}
                  </button>
                </form>
                {hits && hits.length === 0 && <p className="text-[11px] text-ink-faint">No vault notes matched.</p>}
                {hits?.map((h) => (
                  <div key={`${h.file}-${h.score}`} className="rounded-xl border border-line px-3 py-2">
                    <p className="pb-1 font-mono text-[10px] text-ink-faint">{h.file}</p>
                    <div className="max-h-40 overflow-hidden text-xs">
                      <Markdown>{h.text.slice(0, 900)}</Markdown>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        ) : (
          <Panel>
            <EmptyState accent="cyan" title="Loading projects" />
          </Panel>
        )}
      </div>
    </div>
  );
}
