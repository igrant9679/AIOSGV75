"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useModules } from "./useModules";
import type { ModuleDef } from "@/lib/moduleList";

/** /modules (rule 53): switch whole features on or off, for every machine. */
export default function ModulesSection() {
  const { setModule } = useModules();
  const [mods, setMods] = useState<(ModuleDef & { on: boolean })[]>([]);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const load = () => fetch("/api/modules").then((r) => r.json()).then((j) => setMods(j.modules ?? [])).catch(() => {});
  useEffect(() => void load(), []);
  const flip = async (m: ModuleDef & { on: boolean }) => {
    const r = await setModule(m.id, !m.on);
    setMsg(r.error ? { text: r.error, bad: true } : { text: `${m.name} is ${m.on ? "off" : "on"}. Other machines follow within a few minutes.` });
    void load();
  };
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12px] text-ink-faint">A module is a set of pages. Switched off, its pages leave the menu on every machine and any background checking it does stops. Nothing is deleted. To hide or reorder single menu items instead, use <Link href="/appearance" className="underline">Appearance → Menu</Link>.</p>
      {msg && <p className="text-[12px]" style={{ color: msg.bad ? "var(--ac-rose)" : "var(--ac-lime)" }}>{msg.text}</p>}
      <div className="grid gap-3 md:grid-cols-2">
        {mods.map((m) => (
          <div key={m.id} className="panel flex items-start gap-3 p-4" style={{ opacity: m.on ? 1 : 0.7 }}>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-semibold text-ink">{m.name}</p>
              <p className="text-[12px] leading-5 text-ink-dim">{m.blurb}</p>
              <p className="pt-1 text-[11px] text-ink-faint">Pages: {m.hrefs.map((h, i) => (<span key={h}>{i ? ", " : ""}{m.on ? <Link href={h} className="underline">{h.slice(1)}</Link> : h.slice(1)}</span>))}{m.duty ? ` · ${m.duty}` : ""}</p>
            </div>
            <button type="button" role="switch" aria-checked={m.on} aria-label={`${m.name} ${m.on ? "on" : "off"}`} onClick={() => void flip(m)} className="relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors" style={{ background: m.on ? "var(--ac-violet)" : "var(--tone-line-bright)" }}>
              <span className="absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all" style={{ left: m.on ? "22px" : "2px" }} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
