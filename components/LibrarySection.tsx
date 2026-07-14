"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ACCENTS } from "@/lib/accents";
import Panel from "./ui/Panel";
import NumberTicker from "./ui/NumberTicker";
import StatusOrb from "./ui/StatusOrb";
import EmptyState from "./ui/EmptyState";
import Markdown from "./Markdown";
import { useMission } from "./store";

/** Content library — every markdown doc the OS has written into the vault. */

const VAULT_NAME = "IdrisGV75"; // matches Markdown.tsx obsidian:// deep links

interface NoteMeta {
  path: string;
  folder: string;
  name: string;
  mtime: number;
  size: number;
}

function ago(ts: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function LibrarySection() {
  const { vaultOk } = useMission();
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [filter, setFilter] = useState<string>("All");
  const [selected, setSelected] = useState<NoteMeta | null>(null);
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/vault/notes");
      if (res.ok) setNotes(((await res.json()) as { notes: NoteMeta[] }).notes ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const open = useCallback(async (note: NoteMeta) => {
    setSelected(note);
    setLoading(true);
    setContent("");
    try {
      const res = await fetch(`/api/vault/notes?path=${encodeURIComponent(note.path)}`);
      if (res.ok) setContent(((await res.json()) as { content: string }).content ?? "");
      else setContent("_Could not read this note._");
    } catch {
      setContent("_Could not read this note._");
    } finally {
      setLoading(false);
    }
  }, []);

  const folders = useMemo(() => ["All", ...Array.from(new Set(notes.map((n) => n.folder))).sort()], [notes]);
  const visible = filter === "All" ? notes : notes.filter((n) => n.folder === filter);
  const latest = notes[0];

  const download = () => {
    if (!selected) return;
    const blob = new Blob([content], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${selected.name}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Panel title="Total Docs">
          <div className="p-4">
            <span style={{ color: ACCENTS.violet.base }}>
              <NumberTicker value={notes.length} className="text-3xl font-bold" />
            </span>
            <p className="pt-1 font-mono text-[10px] tracking-[0.14em] text-ink-faint">MARKDOWN FILES · AGENTIC OS</p>
          </div>
        </Panel>
        <Panel title="Collections" delay={0.04}>
          <div className="p-4">
            <span style={{ color: ACCENTS.cyan.base }}>
              <NumberTicker value={Math.max(0, folders.length - 1)} className="text-3xl font-bold" />
            </span>
            <p className="pt-1 font-mono text-[10px] tracking-[0.14em] text-ink-faint">VAULT FOLDERS WITH OUTPUT</p>
          </div>
        </Panel>
        <Panel title="Latest" delay={0.08}>
          <div className="p-4">
            <p className="truncate text-xl font-bold" style={{ color: ACCENTS.lime.base }}>
              {latest ? latest.name : "—"}
            </p>
            <p className="pt-1 font-mono text-[10px] tracking-[0.14em] text-ink-faint">
              {latest ? `${latest.folder.toUpperCase()} · ${ago(latest.mtime).toUpperCase()}` : "VAULT EMPTY"}
            </p>
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
        <Panel title="Documents" right={<StatusOrb accent={vaultOk ? "lime" : "rose"} pulsing={false} size={7} />} delay={0.1}>
          <div className="flex flex-col gap-2 p-3">
            <div className="flex flex-wrap gap-1.5">
              {folders.map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className="cursor-pointer rounded-full border px-2.5 py-1 font-mono text-[10px] tracking-[0.08em] transition-colors"
                  style={
                    filter === f
                      ? { background: ACCENTS.violet.soft, color: ACCENTS.violet.base, borderColor: "transparent" }
                      : { borderColor: "var(--color-line)", color: "var(--color-ink-faint)" }
                  }
                >
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
            <div className="flex max-h-[560px] flex-col gap-1.5 overflow-y-auto pr-1">
              {visible.length === 0 && <EmptyState compact accent="violet" title="No documents" hint="Agent output lands here as the OS writes to the vault." />}
              {visible.map((n) => (
                <button
                  key={n.path}
                  onClick={() => open(n)}
                  className="cursor-pointer rounded-xl border border-line bg-white/[0.02] px-3 py-2 text-left transition-colors hover:bg-white/[0.05]"
                  style={selected?.path === n.path ? { borderColor: ACCENTS.violet.base, background: ACCENTS.violet.soft } : undefined}
                >
                  <span className="font-mono text-[9px] tracking-[0.1em]" style={{ color: ACCENTS.cyan.base }}>
                    {n.folder.toUpperCase()}
                  </span>
                  <span className="block truncate text-sm font-semibold text-ink">{n.name}</span>
                  <span className="font-mono text-[10px] text-ink-faint">
                    {ago(n.mtime)} · {(n.size / 1024).toFixed(1)} KB
                  </span>
                </button>
              ))}
            </div>
          </div>
        </Panel>

        <Panel
          title={selected ? selected.path : "Viewer"}
          right={
            selected ? (
              <span className="flex items-center gap-2">
                <a
                  href={`obsidian://open?vault=${encodeURIComponent(VAULT_NAME)}&file=${encodeURIComponent(`Agentic OS/${selected.path.replace(/\.md$/, "")}`)}`}
                  className="rounded-md border border-line px-2 py-0.5 font-mono text-[10px] text-ink-dim transition-colors hover:bg-white/[0.06]"
                >
                  open in Obsidian
                </a>
                <button
                  onClick={download}
                  className="cursor-pointer rounded-md border border-line px-2 py-0.5 font-mono text-[10px] text-ink-dim transition-colors hover:bg-white/[0.06]"
                >
                  ↓ download
                </button>
              </span>
            ) : undefined
          }
          delay={0.14}
        >
          <div className="max-h-[640px] overflow-y-auto p-5">
            {!selected && (
              <p className="py-16 text-center text-sm text-ink-faint">
                Pick a document — everything your agents write to the vault (missions, syntheses, chats, journal) lives here.
              </p>
            )}
            {selected && loading && <p className="py-16 text-center text-sm text-ink-faint">Loading…</p>}
            {selected && !loading && <Markdown>{content}</Markdown>}
          </div>
        </Panel>
      </div>
    </div>
  );
}
