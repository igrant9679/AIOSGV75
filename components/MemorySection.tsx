"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Panel from "./ui/Panel";
import StatusOrb from "./ui/StatusOrb";
import MicButton, { type MicState } from "./MicButton";
import { useMission } from "./store";

interface SearchHit {
  file: string;
  text: string;
  score: number;
}

function VaultSearchPanel() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);

  const run = async () => {
    if (!q.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(`/api/vault/search?q=${encodeURIComponent(q)}`);
      setHits(res.ok ? (((await res.json()) as { results: SearchHit[] }).results ?? []) : []);
    } catch {
      setHits([]);
    } finally {
      setSearching(false);
    }
  };

  return (
    <Panel title="Vault Search" delay={0.08}>
      <div className="flex flex-col gap-2 p-3">
        <div className="flex gap-1.5">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") run();
            }}
            placeholder="Search every note…"
            aria-label="Search vault"
            className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-panel-2 px-3 font-mono text-[11.5px] text-ink outline-none placeholder:text-ink-faint focus:border-line-bright"
          />
          <button
            onClick={run}
            disabled={!q.trim() || searching}
            className="cursor-pointer rounded-lg bg-neon-cyan/15 px-3 font-mono text-[11px] text-neon-cyan transition-colors hover:bg-neon-cyan/25 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {searching ? "…" : "Go"}
          </button>
        </div>
        {hits !== null && hits.length === 0 && <p className="px-1 py-2 text-[11px] text-ink-faint">No matches.</p>}
        {hits?.map((h, i) => (
          <div key={i} className="rounded-lg border border-line bg-white/[0.02] p-2.5">
            <p className="mb-1 truncate font-mono text-[9.5px] text-neon-cyan">{h.file}</p>
            <p className="max-h-24 overflow-hidden whitespace-pre-wrap text-[11px] leading-4.5 text-ink-dim">{h.text}</p>
          </div>
        ))}
        <p className="px-1 text-[10px] leading-4 text-ink-faint">
          The same index feeds your agents — relevant excerpts from any note are injected into their context
          automatically.
        </p>
      </div>
    </Panel>
  );
}

/** Shared memory editor — the one file every agent reads and writes. */
export default function MemorySection() {
  const { memory, refreshMemory, vaultOk, addEvent } = useMission();
  const [content, setContent] = useState(memory);
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [mic, setMic] = useState<MicState>({ listening: false, interim: "" });
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // adopt store updates (e.g. an agent just remembered something) unless mid-edit
  useEffect(() => {
    if (!dirty) setContent(memory);
  }, [memory, dirty]);

  const scheduleSave = useCallback(
    (next: string) => {
      setContent(next);
      setDirty(true);
      setSaveState("saving");
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        try {
          const res = await fetch("/api/memory", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: next }),
          });
          setSaveState(res.ok ? "saved" : "error");
          setDirty(false);
          if (res.ok) refreshMemory();
          else addEvent("MEMORY", "Save failed", "rose");
        } catch {
          setSaveState("error");
        }
      }, 900);
    },
    [refreshMemory, addEvent],
  );

  const dictate = useCallback(
    (phrase: string) => {
      const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
      const line = `- [${stamp} · You] ${phrase}`;
      scheduleSave(content ? `${content.replace(/\s+$/, "")}\n${line}` : line);
    },
    [content, scheduleSave],
  );

  const saveLabel = saveState === "saving" ? "saving…" : saveState === "saved" ? "saved to vault" : saveState === "error" ? "save failed" : "";
  const factCount = content.split(/\r?\n/).filter((l) => l.trim().startsWith("- ")).length;

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_300px]">
      <Panel
        title="Shared Memory"
        right={
          <div className="flex items-center gap-2">
            <StatusOrb accent={vaultOk ? (saveState === "error" ? "rose" : "lime") : "rose"} size={8} pulsing={saveState === "saving"} />
            <span className="font-mono text-[10px] text-ink-dim" aria-live="polite">
              {vaultOk ? saveLabel || "Agentic OS/Memory.md" : "vault offline"}
            </span>
          </div>
        }
      >
        <div className="relative">
          <textarea
            value={mic.listening && mic.interim ? `${content.replace(/\s+$/, "")}\n- ${mic.interim}` : content}
            onChange={(e) => scheduleSave(e.target.value)}
            disabled={!vaultOk}
            placeholder={"Facts every agent should know.\n\n- [date · source] the fact…\n\nAgents add here automatically when they reply with <remember> tags — or dictate a fact with the mic."}
            aria-label="Shared memory"
            className="h-[calc(100dvh-19rem)] min-h-96 w-full resize-none bg-transparent px-6 py-5 font-mono text-[13px] leading-7 text-ink outline-none placeholder:text-ink-faint disabled:opacity-50"
          />
          <div className="absolute bottom-4 right-4 rounded-xl border border-line bg-panel-2/90 p-1 backdrop-blur">
            <MicButton onFinal={dictate} onState={setMic} />
          </div>
        </div>
      </Panel>

      <div className="flex flex-col gap-4">
        <VaultSearchPanel />

        <Panel title="How It Works" delay={0.05}>
          <div className="flex flex-col gap-3 p-4 text-[11.5px] leading-5 text-ink-dim">
            <p>
              <span className="text-neon-lime">Every agent reads this</span> before answering — Claude, OpenClaw, Hermes,
              and any LLM you add.
            </p>
            <p>
              <span className="text-neon-violet">Every agent can write here</span> by including{" "}
              <span className="font-mono">&lt;remember&gt;a fact&lt;/remember&gt;</span> in a reply. The tag is stripped
              from chat and the fact lands in this file.
            </p>
            <p>It&apos;s a normal note in your Obsidian vault — edit it there, here, or by voice.</p>
          </div>
        </Panel>

        <Panel title="Stats" delay={0.1}>
          <dl className="grid grid-cols-2 gap-3 p-4 font-mono text-[11px]">
            <div>
              <dt className="text-ink-faint">FACTS</dt>
              <dd className="text-lg font-semibold text-neon-cyan">{factCount}</dd>
            </div>
            <div>
              <dt className="text-ink-faint">SIZE</dt>
              <dd className="text-lg font-semibold text-neon-magenta">{(content.length / 1024).toFixed(1)}kb</dd>
            </div>
          </dl>
        </Panel>
      </div>
    </div>
  );
}
