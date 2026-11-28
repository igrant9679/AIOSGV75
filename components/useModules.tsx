"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { MODULES, moduleOfPath } from "@/lib/moduleList";

/** Which modules are switched off (rule 53). Cached in this browser so the menu doesn't flicker on load. */
const KEY = "mc-modules-off";
const EVENT = "mc-modules";
const readCache = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

export function useModules() {
  const [off, setOff] = useState<string[]>([]);
  const load = useCallback(() => {
    fetch("/api/modules")
      .then((r) => r.json())
      .then((j) => {
        if (!Array.isArray(j.modules)) return;
        const next = j.modules.filter((m: { on: boolean }) => !m.on).map((m: { id: string }) => m.id);
        setOff(next);
        try {
          localStorage.setItem(KEY, JSON.stringify(next));
        } catch {
          /* fine */
        }
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    setOff(readCache());
    load();
    const on = () => load();
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, [load]);
  const setModule = useCallback(async (id: string, on: boolean) => {
    const r = await (await fetch("/api/modules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, on }) })).json();
    window.dispatchEvent(new Event(EVENT));
    return r as { error?: string };
  }, []);
  const hidden = new Set(MODULES.filter((m) => off.includes(m.id)).flatMap((m) => m.hrefs));
  return { off, hidden, setModule };
}

/** Shown instead of a page whose module is switched off. */
export function ModuleGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { off, setModule } = useModules();
  const mod = moduleOfPath(pathname);
  if (!mod || !off.includes(mod.id)) return <>{children}</>;
  return (
    <div className="panel mx-auto mt-6 flex max-w-xl flex-col items-start gap-3 p-6">
      <p className="text-[16px] font-semibold text-ink">{mod.name} is switched off</p>
      <p className="text-[13px] text-ink-dim">{mod.blurb} Nothing was deleted: switch it back on and it is as you left it.</p>
      <button type="button" onClick={() => void setModule(mod.id, true)} className="cursor-pointer rounded-lg px-3.5 py-1.5 text-[13px] font-semibold text-white" style={{ background: "var(--ac-violet)" }}>
        Switch {mod.name} on
      </button>
    </div>
  );
}
