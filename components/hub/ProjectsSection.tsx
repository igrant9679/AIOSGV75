"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Panel from "../ui/Panel";
import EmptyState from "../ui/EmptyState";
import Markdown from "../Markdown";
import type { SessionSummary } from "@/lib/sessions";
import type { ProjectSource } from "@/lib/projectNames";
import { useHub, SourcePill, ViaTag, StatusDot, HubError, IndexingNote, ago, fmtTokens, stamp, timesLine, timesTitle } from "./common";
import { launchSurface } from "@/lib/launchSurface";
import { useSort, type SortOption } from "./SortControl";
import { SESSION_SORTS } from "./sorts";

interface Passage {
  file: string;
  text: string;
  score: number;
}

interface ProjectGroup {
  name: string;
  sessions: SessionSummary[];
  startedAt: number;
  updatedAt: number;
  lastOpenedAt: number;
  tools: Set<string>;
  hosts: Set<string>;
  tokens: number;
}

interface NamingStatus {
  needsNaming: number;
  lastAiRun: { at: number; named: number; error?: string } | null;
}

const PROJECT_SORTS: SortOption<ProjectGroup>[] = [
  { id: "changed", label: "Last changed", get: (p) => p.updatedAt, dir: "desc", time: true },
  { id: "opened", label: "Last opened", get: (p) => p.lastOpenedAt || undefined, dir: "desc", time: true },
  { id: "first", label: "First session", get: (p) => (p.startedAt === Infinity ? undefined : p.startedAt), dir: "desc", time: true },
  { id: "name", label: "Name", get: (p) => p.name, dir: "asc" },
  { id: "sessions", label: "Sessions", get: (p) => p.sessions.length, dir: "desc" },
  { id: "tokens", label: "Tokens", get: (p) => p.tokens, dir: "desc" },
];

const SOURCE_LABEL: Record<ProjectSource, string> = {
  user: "named by you",
  folder: "started in this folder",
  files: "worked on files in this folder",
  job: "Mission Control's scheduled jobs",
  ai: "grouped by AI",
  unsorted: "not sorted yet — try Group with AI",
};

/** Why a project has its name: the most common source among its sessions. */
function projectSourceOf(g: ProjectGroup): ProjectSource {
  const n = new Map<ProjectSource, number>();
  for (const s of g.sessions) {
    const k = s.projectSource ?? "unsorted";
    n.set(k, (n.get(k) ?? 0) + 1);
  }
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "unsorted";
}

async function postNames(body: object): Promise<{ ok?: boolean; error?: string; named?: number; considered?: number }> {
  const res = await fetch("/api/hub/names", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return res.json();
}

/** Inline rename: shows the text with a pencil; Enter saves, Esc cancels, empty resets. */
function Renamable({
  value,
  onSave,
  className,
  label,
}: {
  value: string;
  onSave: (v: string) => Promise<void>;
  className?: string;
  label: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(value), [value]);
  if (editing) {
    return (
      <form
        className="flex min-w-0 flex-1 items-center gap-1.5"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          await onSave(draft.trim());
          setSaving(false);
          setEditing(false);
        }}
      >
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
          aria-label={label}
          placeholder="empty = automatic name"
          className="min-w-0 flex-1 rounded-md border border-line-bright bg-transparent px-2 py-1 text-xs text-ink outline-none"
        />
        <button type="submit" disabled={saving} className="cursor-pointer rounded-md border border-line px-2 py-1 font-mono text-[10px] text-ink-dim hover:bg-white/[0.06]">
          {saving ? "…" : "Save"}
        </button>
      </form>
    );
  }
  return (
    <span className="group flex min-w-0 items-center gap-1.5">
      <span className={`truncate ${className ?? ""}`}>{value}</span>
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label={label}
        title={label}
        className="shrink-0 cursor-pointer rounded px-1 font-mono text-[11px] text-ink-faint opacity-60 transition-opacity hover:text-ink group-hover:opacity-100"
      >
        ✎
      </button>
    </span>
  );
}

/**
 * Projects — the brain organized by what you were working on rather than by
 * tool: every session in a project, from any tool, plus the memories and vault
 * notes that mention it. Project and session names are resolved in
 * lib/projectNames.ts; renames and AI grouping live in data/session-names.json.
 */
export default function ProjectsSection() {
  const { hub, error, reload } = useHub(30_000);
  const [selected, setSelected] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Passage[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [naming, setNaming] = useState<NamingStatus | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMsg, setAiMsg] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const projectSort = useSort<ProjectGroup>("projects", PROJECT_SORTS);
  const sessionSort = useSort<SessionSummary>("project-sessions", SESSION_SORTS);

  const loadNaming = useCallback(async () => {
    try {
      const res = await fetch("/api/hub/names");
      if (res.ok) setNaming(await res.json());
    } catch {
      /* status is optional */
    }
  }, []);
  useEffect(() => {
    loadNaming();
  }, [loadNaming, hub?.generatedAt]);

  const projects = useMemo<ProjectGroup[]>(() => {
    const map = new Map<string, ProjectGroup>();
    for (const s of hub?.sessions ?? []) {
      if (s.indexing) continue;
      const g = map.get(s.project) ?? {
        name: s.project,
        sessions: [],
        startedAt: Infinity,
        updatedAt: 0,
        lastOpenedAt: 0,
        tools: new Set(),
        hosts: new Set(),
        tokens: 0,
      };
      g.sessions.push(s);
      g.startedAt = Math.min(g.startedAt, s.startedAt || Infinity);
      g.updatedAt = Math.max(g.updatedAt, s.updatedAt);
      g.lastOpenedAt = Math.max(g.lastOpenedAt, s.lastOpenedAt ?? 0);
      g.tools.add(s.tool);
      g.hosts.add(s.host);
      g.tokens += s.tokensIn + s.tokensOut;
      map.set(s.project, g);
    }
    // Unsorted always sinks to the bottom so real projects lead
    const sorted = projectSort.apply([...map.values()]);
    return [...sorted.filter((p) => p.name !== "Unsorted"), ...sorted.filter((p) => p.name === "Unsorted")];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hub, projectSort.option.id, projectSort.dir]);

  const current = projects.find((p) => p.name === selected) ?? projects[0];
  const currentSource = current ? projectSourceOf(current) : "unsorted";
  const currentFolder = current?.sessions.find((s) => s.folder)?.folder;

  useEffect(() => {
    setHits(null);
    setQ("");
    setShowAll(false);
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

  const groupWithAi = async () => {
    setAiBusy(true);
    setAiMsg(null);
    try {
      const r = await postNames({ action: "ai" });
      setAiMsg(r.error && !r.named ? `Couldn't group: ${r.error}` : `Named ${r.named ?? 0} of ${r.considered ?? 0} sessions.`);
      await reload();
      await loadNaming();
    } catch (e) {
      setAiMsg(`Couldn't group: ${(e as Error).message}`);
    } finally {
      setAiBusy(false);
    }
  };

  const renameProject = async (name: string) => {
    if (!current) return;
    await postNames({ action: "rename", keys: current.sessions.map((s) => s.key), project: name });
    if (name) setSelected(name);
    await reload();
  };

  const renameSession = async (key: string, title: string) => {
    await postNames({ action: "rename", keys: [key], title });
    await reload();
  };

  const orderedSessions = useMemo(
    () => (current ? sessionSort.apply(current.sessions) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [current, sessionSort.option.id, sessionSort.dir],
  );
  const visible = showAll ? orderedSessions : orderedSessions.slice(0, 12);

  return (
    <div className="flex flex-col gap-4">
      <HubError error={error} />
      <IndexingNote hub={hub} />
      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <Panel title={`Projects · ${projects.length}`} right={projectSort.control}>
          <div className="flex flex-col gap-2 border-b border-line p-3">
            <button
              type="button"
              onClick={groupWithAi}
              disabled={aiBusy || naming?.needsNaming === 0}
              title="One short Claude Haiku run on your subscription: sorts unsorted sessions into named projects and renames sessions whose title is really a pasted prompt. Your own renames are never changed."
              className="cursor-pointer rounded-lg border px-3 py-1.5 font-mono text-[11px] transition-colors hover:bg-white/[0.06] disabled:cursor-default disabled:opacity-50"
              style={{ borderColor: "var(--page-accent)", color: "var(--page-accent)" }}
            >
              {aiBusy ? "Grouping… (about a minute)" : naming?.needsNaming ? `Group with AI · ${naming.needsNaming} to name` : "Group with AI · all named"}
            </button>
            {(aiMsg || naming?.lastAiRun) && (
              <p className="font-mono text-[10px] leading-4 text-ink-faint">
                {aiMsg ?? `Last AI pass ${ago(naming!.lastAiRun!.at)} ago · ${naming!.lastAiRun!.named} named`}
              </p>
            )}
          </div>
          <div className="flex max-h-[66vh] flex-col gap-1 overflow-y-auto p-2">
            {hub && projects.length === 0 && <EmptyState accent="cyan" title="No sessions yet" compact />}
            {projects.map((p) => {
              const active = p.name === current?.name;
              return (
                <button
                  key={p.name}
                  type="button"
                  onClick={() => setSelected(p.name)}
                  title={`First session ${stamp(p.startedAt)}\nLast changed ${stamp(p.updatedAt)}${p.lastOpenedAt ? `\nLast opened ${stamp(p.lastOpenedAt)}` : ""}`}
                  className="flex cursor-pointer items-center justify-between gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-white/[0.04]"
                  style={active ? { background: "color-mix(in srgb, var(--page-accent) 14%, transparent)" } : undefined}
                >
                  <span className="min-w-0">
                    <span
                      className={`block truncate text-xs font-semibold ${p.name === "Unsorted" ? "italic" : ""}`}
                      style={{ color: active ? "var(--page-accent)" : p.name === "Unsorted" ? "var(--color-ink-dim)" : "var(--color-ink)" }}
                    >
                      {p.name}
                    </span>
                    <span className="block font-mono text-[10px] text-ink-faint">
                      {projectSort.option.id === "opened"
                        ? p.lastOpenedAt
                          ? `opened ${ago(p.lastOpenedAt)} ago`
                          : "never opened in the app"
                        : projectSort.option.id === "first"
                          ? `since ${stamp(p.startedAt === Infinity ? 0 : p.startedAt)}`
                          : projectSort.option.id === "tokens"
                            ? `${fmtTokens(p.tokens)} tokens`
                            : `changed ${ago(p.updatedAt)} ago`}
                    </span>
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
              {current.name === "Unsorted" ? (
                <h3 className="font-display text-lg font-bold italic" style={{ color: "var(--page-accent)" }}>
                  Unsorted
                </h3>
              ) : (
                <Renamable
                  value={current.name}
                  label="Rename this project"
                  onSave={renameProject}
                  className="font-display text-lg font-bold text-[color:var(--page-accent)]"
                />
              )}
              <div className="grid gap-x-6 gap-y-1 pt-2 font-mono text-[11px] text-ink-dim sm:grid-cols-3">
                <span title={current.startedAt !== Infinity ? new Date(current.startedAt).toLocaleString() : ""}>
                  <span className="text-ink-faint">First session </span>
                  {stamp(current.startedAt === Infinity ? 0 : current.startedAt)}
                </span>
                <span title={new Date(current.updatedAt).toLocaleString()}>
                  <span className="text-ink-faint">Last changed </span>
                  {stamp(current.updatedAt)}
                </span>
                <span title={current.lastOpenedAt ? new Date(current.lastOpenedAt).toLocaleString() : "Only the desktop app records when a session was opened"}>
                  <span className="text-ink-faint">Last opened </span>
                  {current.lastOpenedAt ? stamp(current.lastOpenedAt) : "—"}
                </span>
              </div>
              <p className="pt-1 font-mono text-[11px] text-ink-faint">
                {[...current.hosts].join(", ")} · {current.sessions.length} sessions · {fmtTokens(current.tokens)} tokens · {SOURCE_LABEL[currentSource]}
              </p>
              {currentFolder && <p className="truncate pt-0.5 font-mono text-[10px] text-ink-faint">{currentFolder}</p>}
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <Panel title="Sessions across tools" right={sessionSort.control}>
                <div className="flex flex-col p-4">
                  {visible.map((s) => (
                    <div key={s.key} className="flex items-center gap-2 border-b border-line py-2 last:border-b-0" title={timesTitle(s)}>
                      <StatusDot status={s.status === "ended" ? "done" : s.status} />
                      <span className="min-w-0 flex-1">
                        <Renamable value={s.title} label="Rename this session" onSave={(t) => renameSession(s.key, t)} className="text-xs font-semibold text-ink" />
                        <span className="block truncate font-mono text-[10px] text-ink-faint">{timesLine(s)}</span>
                        <span className="block truncate font-mono text-[10px] text-ink-faint">
                          {s.userTurns} prompts · {fmtTokens(s.tokensIn + s.tokensOut)} tokens
                          {s.projectSource === "ai" ? " · grouped by AI" : ""}
                        </span>
                      </span>
                      <ViaTag via={launchSurface(s.origin)} />
                      <SourcePill source={s.tool} />
                    </div>
                  ))}
                  {current.sessions.length > 12 && (
                    <button
                      type="button"
                      onClick={() => setShowAll((v) => !v)}
                      className="cursor-pointer pt-2 text-center font-mono text-[10px] text-ink-faint hover:text-ink"
                    >
                      {showAll ? "Show fewer" : `Show all ${current.sessions.length}`}
                    </button>
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
