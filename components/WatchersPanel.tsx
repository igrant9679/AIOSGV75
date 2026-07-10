"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import type { Watcher, WatcherType } from "@/lib/watchers";
import Panel from "./ui/Panel";
import StatusOrb from "./ui/StatusOrb";
import { useMission } from "./store";
import { IconPlus } from "./icons";

const inputCls =
  "h-8 w-full rounded-lg border border-line bg-panel-2 px-2.5 font-mono text-[10.5px] text-ink outline-none placeholder:text-ink-faint focus:border-line-bright";

/** Event-driven automations: list + create, shown on the Missions page. */
export default function WatchersPanel({ delay = 0.1 }: { delay?: number }) {
  const { addEvent } = useMission();
  const [watchers, setWatchers] = useState<Watcher[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<WatcherType>("file");
  const [pathOrKeyword, setPathOrKeyword] = useState("");
  const [prompt, setPrompt] = useState("");
  const [err, setErr] = useState("");

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/watchers");
      if (res.ok) setWatchers((((await res.json()) as { watchers: Watcher[] }).watchers ?? []));
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    poll();
    const iv = setInterval(poll, 20000);
    return () => clearInterval(iv);
  }, [poll]);

  const create = async () => {
    setErr("");
    const res = await fetch("/api/watchers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        type,
        path: type === "file" ? pathOrKeyword : undefined,
        keyword: type === "memory_mention" ? pathOrKeyword : undefined,
        prompt,
        agentId: "auto",
        notify: true,
      }),
    });
    const json = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok || !json.ok) setErr(json.error ?? "failed");
    else {
      addEvent("WATCHERS", `Watcher armed: ${name}`, "lime");
      setName("");
      setPathOrKeyword("");
      setPrompt("");
      setShowForm(false);
      poll();
    }
  };

  return (
    <Panel title="Watchers" delay={delay}>
      <div className="flex flex-col gap-2 p-3">
        {watchers.length === 0 && !showForm && (
          <p className="px-2 py-3 text-center text-[11px] leading-5 text-ink-faint">
            Event triggers: new file in a folder, goal completed, or a shared-memory mention — each fires a mission and
            pings your Telegram.
          </p>
        )}
        {watchers.map((w) => (
          <div key={w.id} className="rounded-xl border border-line bg-white/[0.02] p-3">
            <div className="flex items-center gap-2">
              <StatusOrb accent={w.enabled ? "lime" : "rose"} pulsing={false} size={7} />
              <p className="min-w-0 flex-1 truncate text-xs font-semibold text-ink">{w.name}</p>
              <button
                onClick={() =>
                  fetch("/api/watchers", {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ id: w.id, enabled: !w.enabled }),
                  }).then(poll)
                }
                aria-pressed={w.enabled}
                className={`cursor-pointer rounded px-1.5 py-0.5 font-mono text-[9px] tracking-wide ${
                  w.enabled ? "bg-neon-lime/15 text-neon-lime" : "bg-white/5 text-ink-faint"
                }`}
              >
                {w.enabled ? "ON" : "OFF"}
              </button>
              <button
                onClick={() => fetch(`/api/watchers?id=${w.id}`, { method: "DELETE" }).then(poll)}
                aria-label={`Delete watcher ${w.name}`}
                className="cursor-pointer rounded p-0.5 font-mono text-[10px] text-ink-faint transition-colors hover:text-neon-rose"
              >
                ✕
              </button>
            </div>
            <p className="mt-1 font-mono text-[9.5px] leading-4 text-ink-faint">
              {w.type.replace("_", " ")}
              {w.config.path ? ` · ${w.config.path}` : ""}
              {w.config.keyword ? ` · "${w.config.keyword}"` : ""}
              {w.lastEvent ? ` · last: ${w.lastEvent.slice(0, 60)}` : " · no events yet"}
            </p>
          </div>
        ))}

        {showForm ? (
          <div className="flex flex-col gap-2 rounded-xl border border-line bg-white/[0.02] p-3">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Watcher name" aria-label="Watcher name" className={inputCls} />
            <select value={type} onChange={(e) => setType(e.target.value as WatcherType)} aria-label="Trigger type" className={`${inputCls} cursor-pointer`}>
              <option value="file">New file in folder</option>
              <option value="goal_done">Goal completed</option>
              <option value="memory_mention">Shared-memory mention</option>
            </select>
            {type !== "goal_done" && (
              <input
                value={pathOrKeyword}
                onChange={(e) => setPathOrKeyword(e.target.value)}
                placeholder={type === "file" ? "C:\\folder\\to\\watch" : "keyword (optional)"}
                aria-label={type === "file" ? "Folder path" : "Keyword"}
                className={inputCls}
              />
            )}
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={2}
              placeholder="Mission prompt — use {{event}} for what happened"
              aria-label="Mission prompt"
              className={`${inputCls} h-auto resize-none py-1.5`}
            />
            {err && <p className="font-mono text-[10px] text-neon-rose">{err}</p>}
            <div className="flex gap-2">
              <button onClick={create} disabled={!name.trim() || !prompt.trim()} className="flex-1 cursor-pointer rounded-lg bg-neon-lime/15 py-1.5 text-xs font-semibold text-neon-lime disabled:opacity-35">
                Arm watcher
              </button>
              <button onClick={() => setShowForm(false)} className="cursor-pointer rounded-lg bg-white/5 px-3 text-xs text-ink-faint">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => setShowForm(true)}
            className="flex cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-dashed border-line py-2 text-xs text-ink-faint transition-colors hover:border-line-bright hover:text-ink"
          >
            <IconPlus width={13} height={13} /> New watcher
          </motion.button>
        )}
      </div>
    </Panel>
  );
}
