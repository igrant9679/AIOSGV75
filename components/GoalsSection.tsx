"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Panel from "./ui/Panel";
import RingDial from "./ui/RingDial";
import NumberTicker from "./ui/NumberTicker";
import StatusOrb from "./ui/StatusOrb";
import MicButton, { type MicState } from "./MicButton";
import { IconPlus, IconCheck, IconTrash } from "./icons";
import { useMission } from "./store";

interface Task {
  text: string;
  done: boolean;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export default function GoalsSection() {
  const { addEvent, vaultOk, registry, workspace, setWorkspace } = useMission();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [draft, setDraft] = useState("");
  const [mic, setMic] = useState<MicState>({ listening: false, interim: "" });
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLoaded(false);
    fetch(`/api/vault/goals?workspace=${encodeURIComponent(workspace)}`)
      .then((r) => (r.ok ? r.json() : { tasks: [] }))
      .then((d: { tasks: Task[] }) => setTasks(d.tasks ?? []))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [workspace]);

  const persist = useCallback(
    (next: Task[]) => {
      setTasks(next);
      setSaveState("saving");
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(async () => {
        try {
          const res = await fetch("/api/vault/goals", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tasks: next, workspace }),
          });
          setSaveState(res.ok ? "saved" : "error");
          if (!res.ok) addEvent("VAULT", "Goals save failed", "rose");
        } catch {
          setSaveState("error");
          addEvent("VAULT", "Goals save failed", "rose");
        }
      }, 500);
    },
    [addEvent, workspace],
  );

  const addTask = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t) return;
      setDraft("");
      persist([...tasks, { text: t, done: false }]);
      addEvent("GOALS", `New goal: ${t.slice(0, 60)}`, "cyan");
      inputRef.current?.focus();
    },
    [tasks, persist, addEvent],
  );

  const toggle = (i: number) => {
    const next = tasks.map((t, idx) => (idx === i ? { ...t, done: !t.done } : t));
    persist(next);
    if (next[i].done) addEvent("GOALS", `Completed: ${next[i].text.slice(0, 60)} ✓`, "lime");
  };

  const remove = (i: number) => persist(tasks.filter((_, idx) => idx !== i));

  const doneCount = tasks.filter((t) => t.done).length;
  const frac = tasks.length > 0 ? doneCount / tasks.length : 0;

  const saveLabel =
    saveState === "saving" ? "saving…" : saveState === "saved" ? "synced to vault" : saveState === "error" ? "save failed" : "";

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_300px]">
      <Panel
        title="Goals"
        right={
          <div className="flex items-center gap-2.5">
            <select
              value={workspace}
              onChange={(e) => setWorkspace(e.target.value)}
              aria-label="Workspace"
              className="cursor-pointer rounded-lg border border-line bg-panel-2 px-2 py-1 font-mono text-[10px] text-ink-dim outline-none focus:border-line-bright"
            >
              {registry.workspaces.map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
            <StatusOrb accent={vaultOk ? "lime" : "rose"} size={8} pulsing={false} />
            <span className="font-mono text-[10px] text-ink-dim">
              {vaultOk ? (saveLabel || "Goals.md") : "vault offline"}
            </span>
          </div>
        }
      >
        {/* add goal */}
        <div className="border-b border-line px-4 py-3">
          <div
            className="flex items-center gap-1.5 rounded-2xl border border-line bg-panel-2 p-1.5 transition-colors focus-within:border-line-bright"
            style={mic.listening ? { borderColor: "rgba(251,113,133,0.4)" } : undefined}
          >
            <input
              ref={inputRef}
              value={mic.listening && mic.interim ? `${draft ? draft + " " : ""}${mic.interim}` : draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addTask(draft);
              }}
              placeholder={mic.listening ? "Listening…" : "Add a goal… (Enter to save)"}
              aria-label="New goal"
              className="h-10 flex-1 bg-transparent px-3 text-[13.5px] text-ink outline-none placeholder:text-ink-faint"
            />
            <MicButton onFinal={(t) => setDraft((prev) => (prev ? `${prev.replace(/\s+$/, "")} ${t}` : t))} onState={setMic} />
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={() => addTask(draft)}
              disabled={!draft.trim()}
              aria-label="Add goal"
              className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-gradient-to-br from-cyan-600 to-neon-cyan text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-30"
            >
              <IconPlus width={16} height={16} />
            </motion.button>
          </div>
        </div>

        {/* task list */}
        <div className="min-h-80 px-3 py-3">
          {loaded && tasks.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <p className="text-sm font-medium text-ink">No goals yet</p>
              <p className="max-w-xs text-xs leading-5 text-ink-faint">
                Type or dictate one above — it lands in your Obsidian vault as a checkbox task.
              </p>
            </div>
          )}
          <ul className="flex flex-col gap-1">
            <AnimatePresence initial={false}>
              {tasks.map((t, i) => (
                <motion.li
                  key={`${i}-${t.text}`}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.2 }}
                  className="group flex items-center gap-3 rounded-xl px-2 py-1.5 transition-colors hover:bg-white/[0.03]"
                >
                  <button
                    role="checkbox"
                    aria-checked={t.done}
                    aria-label={t.text}
                    onClick={() => toggle(i)}
                    className={`flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-lg border transition-all ${
                      t.done
                        ? "border-neon-lime bg-neon-lime text-black"
                        : "border-line-bright bg-transparent hover:border-neon-lime/60"
                    }`}
                  >
                    {t.done && <IconCheck width={13} height={13} />}
                  </button>
                  <span
                    className={`min-w-0 flex-1 break-words py-1 text-[13.5px] leading-6 transition-all ${
                      t.done ? "text-ink-faint line-through" : "text-ink"
                    }`}
                  >
                    {t.text}
                  </span>
                  <button
                    onClick={() => remove(i)}
                    aria-label={`Delete goal: ${t.text}`}
                    className="cursor-pointer rounded-lg p-1.5 text-ink-faint opacity-0 transition-all hover:bg-white/[0.06] hover:text-neon-rose group-hover:opacity-100"
                  >
                    <IconTrash width={14} height={14} />
                  </button>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </div>
      </Panel>

      <div className="flex flex-col gap-4">
        <Panel title="Progress" delay={0.05}>
          <div className="flex flex-col items-center gap-3 p-5">
            <RingDial frac={frac} accent={frac >= 1 && tasks.length > 0 ? "lime" : "cyan"} size={150} stroke={9}>
              <span className="font-mono text-2xl font-bold text-ink">
                <NumberTicker value={frac * 100} decimals={0} suffix="%" />
              </span>
              <span className="font-mono text-[10px] text-ink-faint">
                {doneCount}/{tasks.length}
              </span>
            </RingDial>
            <p className="text-center font-mono text-[10px] tracking-[0.18em] text-ink-faint">
              {tasks.length === 0
                ? "SET YOUR FIRST TARGET"
                : frac >= 1
                  ? "ALL TARGETS NEUTRALIZED 🎉"
                  : `${tasks.length - doneCount} TARGET${tasks.length - doneCount === 1 ? "" : "S"} REMAINING`}
            </p>
          </div>
        </Panel>

        <Panel title="Vault" delay={0.1}>
          <dl className="flex flex-col gap-2.5 p-4 font-mono text-[11px]">
            <div>
              <dt className="text-ink-faint">FILE</dt>
              <dd className="text-ink-dim">Agentic OS/Goals.md</dd>
            </div>
            <div>
              <dt className="text-ink-faint">FORMAT</dt>
              <dd className="text-ink-dim">Obsidian checkbox tasks — edit from either side</dd>
            </div>
          </dl>
        </Panel>
      </div>
    </div>
  );
}
