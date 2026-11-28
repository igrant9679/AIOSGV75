"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconSun, IconMoon, IconHelp, IconSearch } from "./icons";
import { openHelp } from "./HelpDrawer";
import { useMission } from "./store";
import { APPEARANCE_EVENT } from "@/lib/appearance";
import { metaForPath } from "@/lib/accents";

/**
 * The Studio frame's top bar (Appearance → Frame → Studio): where you are, one search box that opens the
 * command palette (Ctrl/⌘ K), how many things wait on you, which engines are ready, light / dark, Help.
 * Shown by CSS (.studio-only) so there is no flash; the Deck frame keeps Header.tsx.
 */
export default function TopBar() {
  const pathname = usePathname();
  const meta = metaForPath(pathname);
  const { system, agents } = useMission();
  const [theme, setTheme] = useState("light");
  const [waiting, setWaiting] = useState<number | null>(null);

  useEffect(() => {
    const sync = () => setTheme(document.documentElement.dataset.theme ?? "light");
    sync();
    window.addEventListener(APPEARANCE_EVENT, sync);
    return () => window.removeEventListener(APPEARANCE_EVENT, sync);
  }, []);
  useEffect(() => {
    let live = true;
    const load = () =>
      fetch("/api/board?count=1")
        .then((r) => r.json())
        .then((j) => live && setWaiting(typeof j.waiting === "number" ? j.waiting : null))
        .catch(() => {});
    load();
    const t = setInterval(load, 30_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);
  const pick = (next: "light" | "dark") => {
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("mc-theme", next);
    } catch {
      /* private mode */
    }
    window.dispatchEvent(new Event(APPEARANCE_EVENT));
  };
  const engines = [
    { name: "Claude", ok: Boolean(system?.claudeVersion) },
    ...agents.filter((a) => ["codex", "hermes", "openclaw"].includes(a.id)).map((a) => ({ name: a.name, ok: a.available })),
  ];
  const ready = engines.filter((e) => e.ok).length;
  return (
    <div className="studio-only studio-bar">
      <span className="text-[13px] font-semibold text-ink">{meta.title}</span>
      <span className="flex-1" />
      <button type="button" className="studio-search" onClick={() => window.dispatchEvent(new Event("mc-open-palette"))} aria-label="Search or run a command">
        <IconSearch width={14} height={14} />
        <span>Search, or go anywhere</span>
        <span className="studio-kbd">Ctrl K</span>
      </button>
      {waiting !== null && waiting > 0 && (
        <Link href="/city" className="studio-chip" style={{ borderColor: "color-mix(in srgb, var(--ac-amber) 50%, transparent)", color: "var(--ac-amber)" }}>
          <b>{waiting}</b> waiting on you
        </Link>
      )}
      <span className="studio-chip hidden lg:inline-flex" title={engines.map((e) => `${e.name}: ${e.ok ? "ready" : "not available here"}`).join(" · ")}>
        <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: ready ? "var(--ac-lime)" : "var(--ac-rose)" }} />
        {ready} of {engines.length} engines ready here
      </span>
      <span className="studio-seg" role="group" aria-label="Theme">
        <button type="button" aria-pressed={theme !== "dark"} onClick={() => pick("light")}>
          <IconSun width={13} height={13} /> Light
        </button>
        <button type="button" aria-pressed={theme === "dark"} onClick={() => pick("dark")}>
          <IconMoon width={13} height={13} /> Dark
        </button>
      </span>
      <button type="button" onClick={() => openHelp()} className="studio-chip cursor-pointer" aria-label="Help" title="Help (F1)">
        <IconHelp width={14} height={14} /> Help
      </button>
    </div>
  );
}
