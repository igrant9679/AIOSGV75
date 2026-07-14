"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ACCENTS } from "@/lib/accents";
import Panel from "./ui/Panel";
import StatusOrb from "./ui/StatusOrb";
import MicButton, { type MicState } from "./MicButton";
import { useMission } from "./store";

function prettyDate(stamp: string) {
  return new Date(`${stamp}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function stampOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Consecutive days written, counting back from today (or yesterday). */
function streakOf(dates: Set<string>, today: string): number {
  const cursor = new Date(`${today}T12:00:00`);
  if (!dates.has(stampOf(cursor))) cursor.setDate(cursor.getDate() - 1); // today not written yet doesn't break it
  let n = 0;
  while (dates.has(stampOf(cursor))) {
    n++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return n;
}

/** GitHub-style 12-week writing heatmap; click a cell to open that day. */
function WritingHeatmap({
  dates,
  active,
  today,
  onPick,
}: {
  dates: Set<string>;
  active: string | null;
  today: string | null;
  onPick: (d: string) => void;
}) {
  if (!today) return null;
  const end = new Date(`${today}T12:00:00`);
  // pad forward so the final column ends on Saturday, then walk back 12 weeks
  const cells: { stamp: string; future: boolean }[] = [];
  const start = new Date(end);
  start.setDate(start.getDate() - (7 * 12 - 1) - ((end.getDay() + 1) % 7));
  const cursor = new Date(start);
  for (let i = 0; i < 7 * 12; i++) {
    const stamp = stampOf(cursor);
    cells.push({ stamp, future: stamp > today });
    cursor.setDate(cursor.getDate() + 1);
  }
  const weeks: (typeof cells)[] = [];
  for (let w = 0; w < 12; w++) weeks.push(cells.slice(w * 7, w * 7 + 7));
  const c = ACCENTS.rose;
  return (
    <div className="flex justify-center gap-[3px]" aria-label="12-week writing activity">
      {weeks.map((week, wi) => (
        <div key={wi} className="flex flex-col gap-[3px]">
          {week.map((cell) => {
            const wrote = dates.has(cell.stamp);
            return (
              <button
                key={cell.stamp}
                onClick={() => wrote && onPick(cell.stamp)}
                disabled={!wrote}
                title={`${cell.stamp}${wrote ? " — open entry" : ""}`}
                aria-label={cell.stamp}
                className={`h-3 w-3 rounded-[3px] transition-transform ${wrote ? "cursor-pointer hover:scale-125" : ""}`}
                style={{
                  background: cell.future ? "transparent" : wrote ? c.base : "var(--color-line)",
                  opacity: cell.future ? 0 : wrote ? (cell.stamp === active ? 1 : 0.75) : 0.5,
                  outline: cell.stamp === active ? `1.5px solid ${c.base}` : undefined,
                  outlineOffset: 1,
                }}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

export default function JournalSection() {
  const { addEvent, vaultOk, registry, workspace, setWorkspace } = useMission();
  const [date, setDate] = useState<string | null>(null);
  const [today, setToday] = useState<string | null>(null);
  const [dates, setDates] = useState<string[]>([]);
  const [content, setContent] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "dirty" | "saving" | "saved" | "error">("idle");
  const [mic, setMic] = useState<MicState>({ listening: false, interim: "" });
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(
    async (d?: string) => {
      setLoaded(false);
      const params = new URLSearchParams();
      if (d) params.set("date", d);
      params.set("workspace", workspace);
      const res = await fetch(`/api/vault/journal?${params}`);
      if (res.ok) {
        const data = (await res.json()) as { date: string; content: string; dates: string[]; today: string };
        setDate(data.date);
        setToday(data.today);
        setContent(data.content);
        setDates(data.dates.includes(data.today) ? data.dates : [data.today, ...data.dates]);
        setSaveState("idle");
      }
      setLoaded(true);
    },
    [workspace],
  );

  useEffect(() => {
    load();
  }, [load]);

  const scheduleSave = useCallback(
    (next: string, forDate: string) => {
      setContent(next);
      setSaveState("dirty");
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        setSaveState("saving");
        try {
          const res = await fetch("/api/vault/journal", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ date: forDate, content: next, workspace }),
          });
          setSaveState(res.ok ? "saved" : "error");
          if (!res.ok) addEvent("VAULT", "Journal save failed", "rose");
        } catch {
          setSaveState("error");
          addEvent("VAULT", "Journal save failed", "rose");
        }
      }, 900);
    },
    [addEvent, workspace],
  );

  const dictate = useCallback(
    (phrase: string) => {
      if (!date) return;
      const next = content ? `${content.replace(/\s+$/, "")} ${phrase}` : phrase;
      scheduleSave(next, date);
      // keep the caret at the end so follow-up typing continues naturally
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (el) {
          el.focus();
          el.selectionStart = el.selectionEnd = el.value.length;
        }
      });
    },
    [content, date, scheduleSave],
  );

  const words = content.trim() ? content.trim().split(/\s+/).length : 0;
  const saveLabel =
    saveState === "dirty" || saveState === "saving"
      ? "saving…"
      : saveState === "saved"
        ? "saved to vault"
        : saveState === "error"
          ? "save failed"
          : "";

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_300px]">
      <Panel
        title={date ? prettyDate(date) : "Journal"}
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
            <StatusOrb accent={vaultOk ? (saveState === "error" ? "rose" : "lime") : "rose"} size={8} pulsing={saveState === "saving"} />
            <span className="font-mono text-[10px] text-ink-dim" aria-live="polite">
              {vaultOk ? (saveLabel || `Journal/${date ?? "…"}.md`) : "vault offline"}
            </span>
          </div>
        }
      >
        <div className="relative">
          <textarea
            ref={textareaRef}
            value={mic.listening && mic.interim ? `${content ? content.replace(/\s+$/, "") + " " : ""}${mic.interim}` : content}
            onChange={(e) => date && scheduleSave(e.target.value, date)}
            disabled={!loaded || !vaultOk}
            placeholder={
              mic.listening
                ? "Listening…"
                : `What happened today?\n\nType or hit the mic and talk — every word autosaves into your Obsidian vault.`
            }
            aria-label="Journal entry"
            className="h-[calc(100dvh-19rem)] min-h-96 w-full resize-none bg-transparent px-6 py-5 text-[14.5px] leading-7 text-ink outline-none placeholder:text-ink-faint disabled:opacity-50"
          />
          <div className="absolute bottom-4 right-4 flex items-center gap-2">
            {mic.listening && (
              <span className="rounded-lg bg-neon-rose/15 px-2.5 py-1.5 font-mono text-[10px] text-neon-rose" aria-live="polite">
                ● listening
              </span>
            )}
            <div className="rounded-xl border border-line bg-panel-2/90 p-1 backdrop-blur">
              <MicButton onFinal={dictate} onState={setMic} />
            </div>
          </div>
        </div>
      </Panel>

      <div className="flex flex-col gap-4">
        <Panel title="Days" delay={0.05}>
          <ul className="flex max-h-72 flex-col gap-0.5 overflow-y-auto p-2">
            {dates.map((d) => {
              const active = d === date;
              return (
                <li key={d}>
                  <motion.button
                    whileTap={{ scale: 0.98 }}
                    onClick={() => load(d)}
                    aria-current={active ? "date" : undefined}
                    className={`flex w-full cursor-pointer items-center justify-between rounded-lg px-3 py-2 font-mono text-[11.5px] transition-colors ${
                      active ? "bg-neon-cyan/10 text-neon-cyan" : "text-ink-dim hover:bg-white/[0.04]"
                    }`}
                  >
                    <span>{d}</span>
                    {d === today && <span className="text-[9px] tracking-[0.18em] text-ink-faint">TODAY</span>}
                  </motion.button>
                </li>
              );
            })}
          </ul>
        </Panel>

        <Panel title="Writing Rhythm" delay={0.08}>
          <div className="flex flex-col gap-3 p-4">
            <WritingHeatmap dates={new Set(dates)} active={date} today={today} onPick={(d) => load(d)} />
            <p className="text-center font-mono text-[9px] tracking-[0.18em] text-ink-faint">LAST 12 WEEKS · CLICK A DAY TO OPEN IT</p>
          </div>
        </Panel>

        <Panel title="Entry Stats" delay={0.1}>
          <dl className="grid grid-cols-2 gap-3 p-4 font-mono text-[11px]">
            <div>
              <dt className="text-ink-faint">WORDS</dt>
              <dd className="text-lg font-semibold text-neon-cyan">{words}</dd>
            </div>
            <div>
              <dt className="text-ink-faint">STREAK</dt>
              <dd className="text-lg font-semibold" style={{ color: ACCENTS.rose.base }}>
                {today ? streakOf(new Set(dates), today) : 0}
                <span className="pl-1 text-[10px] text-ink-faint">days</span>
              </dd>
            </div>
            <div>
              <dt className="text-ink-faint">DAYS LOGGED</dt>
              <dd className="text-lg font-semibold text-neon-magenta">{dates.length}</dd>
            </div>
            <div>
              <dt className="text-ink-faint">FILE</dt>
              <dd className="truncate text-ink-dim">Journal/{date ?? "…"}.md</dd>
            </div>
          </dl>
        </Panel>
      </div>
    </div>
  );
}
