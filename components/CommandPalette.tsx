"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ACCENTS, type Accent } from "@/lib/accents";
import { useMission } from "./store";

/**
 * ⌘K / Ctrl+K command palette: fuzzy jump to any page or agent.
 * Rendered globally from Shell.
 */
interface Command {
  id: string;
  label: string;
  hint: string;
  accent: Accent;
  href: string;
}

const PAGES: Command[] = [
  { id: "overview", label: "Overview", hint: "fleet & vitals", accent: "cyan", href: "/" },
  { id: "mastermind", label: "Mastermind", hint: "all agents, one room", accent: "cyan", href: "/mastermind" },
  { id: "jarvis", label: "JARVIS", hint: "voice command center", accent: "cyan", href: "/jarvis" },
  { id: "pipeline", label: "Pipeline", hint: "inbox → shipped", accent: "violet", href: "/pipeline" },
  { id: "builds", label: "Builds", hint: "games & apps shelf", accent: "magenta", href: "/builds" },
  { id: "studio", label: "Studio", hint: "image · voice · video", accent: "magenta", href: "/studio" },
  { id: "watcher", label: "YouTube Watcher", hint: "trend radar", accent: "rose", href: "/watcher" },
  { id: "hermeslab", label: "Hermes Lab", hint: "goal mode · control room", accent: "amber", href: "/hermes-lab" },
  { id: "missions", label: "Missions", hint: "multi-agent tasks", accent: "cyan", href: "/missions" },
  { id: "tasks", label: "Tasks", hint: "kanban + orchestrator", accent: "amber", href: "/tasks" },
  { id: "schedule", label: "Schedule", hint: "cron calendar", accent: "lime", href: "/schedule" },
  { id: "library", label: "Library", hint: "vault documents", accent: "violet", href: "/library" },
  { id: "graph", label: "Graph", hint: "knowledge graph", accent: "magenta", href: "/graph" },
  { id: "arena", label: "Arena", hint: "model battles", accent: "rose", href: "/arena" },
  { id: "analytics", label: "Analytics", hint: "cost & usage", accent: "amber", href: "/analytics" },
  { id: "evals", label: "Evals", hint: "model report cards", accent: "violet", href: "/evals" },
  { id: "goals", label: "Goals", hint: "checkbox targets", accent: "lime", href: "/goals" },
  { id: "journal", label: "Journal", hint: "one file per day", accent: "rose", href: "/journal" },
  { id: "memory", label: "Memory", hint: "shared brain", accent: "violet", href: "/memory" },
  { id: "settings", label: "Settings", hint: "LLMs · agents · spaces", accent: "cyan", href: "/settings" },
  { id: "guide", label: "Guide", hint: "searchable manual", accent: "magenta", href: "/guide" },
];

export default function CommandPalette() {
  const router = useRouter();
  const { registry, agents } = useMission();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands = useMemo<Command[]>(
    () => [
      ...PAGES,
      { id: "claude", label: "Claude", hint: "chat · operator", accent: "violet", href: "/claude" },
      { id: "auto", label: "Auto", hint: "chat · smart router", accent: "cyan", href: "/auto" },
      ...agents.map((a) => ({ id: a.id, label: a.name, hint: `chat · ${a.tagline.slice(0, 30)}`, accent: a.accent, href: `/${a.id}` })),
      ...registry.llms.map((l) => ({ id: l.id, label: l.name, hint: `chat · ${l.model}`, accent: l.accent, href: `/agent/${l.id}` })),
      ...registry.commandAgents.map((c) => ({ id: c.id, label: c.name, hint: `chat · ${c.tagline.slice(0, 30)}`, accent: c.accent, href: `/agent/${c.id}` })),
    ],
    [agents, registry]
  );

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    // fuzzy-ish: every query char must appear in order
    const fuzzy = (text: string) => {
      let i = 0;
      for (const ch of text.toLowerCase()) if (ch === q[i]) i++;
      return i === q.length;
    };
    return commands
      .filter((c) => c.label.toLowerCase().includes(q) || c.hint.toLowerCase().includes(q) || fuzzy(c.label))
      .sort((a, b) => Number(b.label.toLowerCase().startsWith(q)) - Number(a.label.toLowerCase().startsWith(q)));
  }, [commands, query]);

  const go = useCallback(
    (cmd: Command | undefined) => {
      if (!cmd) return;
      setOpen(false);
      setQuery("");
      router.push(cmd.href);
    },
    [router]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
        setQuery("");
        setIndex(0);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 30);
  }, [open]);

  useEffect(() => setIndex(0), [query]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[18vh] backdrop-blur-sm"
      onClick={() => setOpen(false)}
      role="dialog"
      aria-label="Command palette"
    >
      <div className="panel w-full max-w-lg overflow-hidden rounded-2xl border border-line-bright shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <span className="font-mono text-[10px] tracking-[0.2em] text-ink-faint">GO TO</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIndex((i) => Math.min(matches.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIndex((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter") {
                go(matches[index]);
              }
            }}
            placeholder="page or agent…"
            aria-label="Search pages and agents"
            className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
          />
          <kbd className="rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-ink-faint">esc</kbd>
        </div>
        <div className="max-h-72 overflow-y-auto p-2">
          {matches.length === 0 && <p className="py-6 text-center text-xs text-ink-faint">No matches.</p>}
          {matches.slice(0, 12).map((cmd, i) => (
            <button
              key={cmd.id + cmd.href}
              onClick={() => go(cmd)}
              onMouseEnter={() => setIndex(i)}
              className="flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-left"
              style={i === index ? { background: ACCENTS[cmd.accent].soft } : undefined}
            >
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: ACCENTS[cmd.accent].base }} />
              <span className="flex-1 text-sm font-semibold" style={{ color: i === index ? ACCENTS[cmd.accent].base : "var(--color-ink)" }}>
                {cmd.label}
              </span>
              <span className="font-mono text-[10px] text-ink-faint">{cmd.hint}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
