"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ACCENTS, type Accent } from "@/lib/accents";
import type { PipelineItem, PipelineStage, ItemType } from "@/lib/pipeline";
import Panel from "./ui/Panel";
import StatusOrb from "./ui/StatusOrb";
import Markdown from "./Markdown";
import MicButton from "./MicButton";
import { IconTrash } from "./icons";
import { useMission } from "./store";

const STAGES: { key: PipelineStage; label: string; sub: string; accent: Accent }[] = [
  { key: "capture", label: "Capture", sub: "raw input", accent: "cyan" },
  { key: "classify", label: "Classify", sub: "agents sorting", accent: "violet" },
  { key: "gate", label: "Human Gate", sub: "your one checkpoint", accent: "amber" },
  { key: "execute", label: "Execute", sub: "agents building", accent: "magenta" },
  { key: "shipped", label: "Shipped & Filed", sub: "done", accent: "lime" },
];

const TYPE_ACCENT: Record<ItemType, Accent> = {
  project: "magenta",
  action: "cyan",
  idea: "violet",
  reference: "lime",
  escalate: "rose",
};

export default function PipelineSection() {
  const { addEvent } = useMission();
  const [items, setItems] = useState<PipelineItem[]>([]);
  const [input, setInput] = useState("");
  const [detail, setDetail] = useState<PipelineItem | null>(null);

  const busy = items.some((i) => i.stage === "classify" || i.stage === "execute");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/pipeline");
      if (res.ok) setItems(((await res.json()) as { items: PipelineItem[] }).items ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, busy ? 3_500 : 15_000);
    return () => clearInterval(t);
  }, [load, busy]);

  const capture = async () => {
    const v = input.trim();
    if (!v) return;
    setInput("");
    await fetch("/api/pipeline", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input: v }) });
    addEvent("PIPELINE", `Captured: ${v.slice(0, 60)}`, "cyan");
    load();
  };

  const act = async (id: string, action: "approve" | "reject") => {
    await fetch("/api/pipeline", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action }) });
    load();
  };
  const del = async (id: string) => {
    await fetch(`/api/pipeline?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (detail?.id === id) setDetail(null);
    load();
  };

  return (
    <div className="flex flex-col gap-4">
      <Panel title="From Inbox to Shipped" right={<span className="font-mono text-[10px] text-ink-faint">one human checkpoint · everything else is agents</span>}>
        <div className="flex flex-col gap-3 p-4">
          <p className="text-[12px] leading-5 text-ink-faint">
            Drop an idea — a project, a thought, a link, anything. Claude classifies + routes it. Small stuff files itself to your
            vault; buildable projects wait for your one <span className="text-neon-amber">Approve</span>, then agents build and ship them.
          </p>
          <div className="flex items-start gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  capture();
                }
              }}
              rows={2}
              placeholder="Drop an idea — agents take it from here…"
              className="min-h-14 w-full resize-none rounded-xl border border-line bg-panel-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-line-bright"
            />
            <div className="flex flex-col gap-2">
              <MicButton onFinal={(t) => setInput((v) => (v ? `${v} ${t}` : t))} />
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={capture}
                disabled={!input.trim()}
                className="cursor-pointer rounded-xl bg-gradient-to-br from-cyan-600 to-neon-cyan px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-35"
              >
                Capture
              </motion.button>
            </div>
          </div>
        </div>
      </Panel>

      <div className="grid gap-3 lg:grid-cols-5">
        {STAGES.map((stage, si) => {
          const col = items.filter((i) => i.stage === stage.key);
          return (
            <Panel
              key={stage.key}
              title={stage.label}
              right={<span className="font-mono text-[11px] text-ink-faint">{col.length}</span>}
              delay={0.05 + si * 0.04}
            >
              <div className="flex min-h-[120px] flex-col gap-2 p-3">
                <p className="pb-1 font-mono text-[9px] tracking-[0.12em] text-ink-faint">{stage.sub.toUpperCase()}</p>
                {col.length === 0 && <p className="py-3 text-center text-[11px] text-ink-faint">—</p>}
                {col.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => setDetail(item)}
                    className="group cursor-pointer rounded-xl border border-line bg-white/[0.02] p-2.5 transition-colors hover:border-line-bright"
                    style={{ borderLeft: `3px solid ${ACCENTS[item.type ? TYPE_ACCENT[item.type] : stage.accent].base}` }}
                  >
                    <div className="flex items-start justify-between gap-1">
                      <p className="min-w-0 flex-1 text-[12px] font-semibold leading-4 text-ink">{item.title}</p>
                      {(item.stage === "classify" || item.stage === "execute") && <StatusOrb accent={stage.accent} pulsing size={6} />}
                    </div>
                    {item.type && (
                      <p className="pt-1 font-mono text-[9px] tracking-[0.08em]" style={{ color: ACCENTS[TYPE_ACCENT[item.type]].base }}>
                        {item.type} {item.confidence != null ? `${item.confidence}%` : ""} {item.tags.join(" ")}
                      </p>
                    )}
                    {item.stage === "gate" && (
                      <div className="flex gap-1.5 pt-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            act(item.id, "approve");
                          }}
                          className="flex-1 cursor-pointer rounded-md py-1 text-center text-[10px] font-semibold text-black"
                          style={{ background: ACCENTS.lime.base }}
                        >
                          Approve
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            act(item.id, "reject");
                          }}
                          className="cursor-pointer rounded-md border border-line px-2 py-1 text-[10px] text-ink-faint hover:text-neon-rose"
                        >
                          ⊘
                        </button>
                      </div>
                    )}
                    {item.stage === "shipped" && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setDetail(item);
                        }}
                        className="mt-1.5 cursor-pointer font-mono text-[9px] text-ink-faint hover:text-neon-lime"
                      >
                        ★ view what was built
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </Panel>
          );
        })}
      </div>

      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={() => setDetail(null)}>
          <div className="panel flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-line-bright" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{detail.title}</span>
              <span className="flex items-center gap-2">
                <button onClick={() => del(detail.id)} className="cursor-pointer text-ink-faint hover:text-neon-rose"><IconTrash width={13} height={13} /></button>
                <button onClick={() => setDetail(null)} className="cursor-pointer rounded-md border border-line px-2 py-0.5 font-mono text-[10px] text-ink-dim hover:bg-white/[0.06]">✕</button>
              </span>
            </div>
            <div className="overflow-y-auto p-5">
              <p className="font-mono text-[10px] tracking-[0.1em] text-ink-faint">
                {detail.type ?? "classifying"} {detail.confidence != null ? `· ${detail.confidence}%` : ""} · {detail.stage} {detail.tags.join(" ")}
              </p>
              <p className="pt-2 text-sm text-ink-dim"><span className="text-ink-faint">Captured:</span> {detail.input}</p>
              {detail.plan && <p className="pt-2 text-sm text-ink-dim"><span className="text-ink-faint">Plan:</span> {detail.plan}</p>}
              {detail.result && (
                <div className="mt-3 max-h-96 overflow-y-auto rounded-xl border border-line bg-white/[0.015] p-3">
                  <Markdown>{detail.result}</Markdown>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
