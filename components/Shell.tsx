"use client";

import type { CSSProperties, ReactNode } from "react";
import { usePathname } from "next/navigation";
import { ACCENTS, accentForPath } from "@/lib/accents";
import { MissionProvider } from "./store";
import Header from "./Header";
import Sidebar from "./Sidebar";
import ApprovalsBar from "./ApprovalsBar";
import CommandPalette from "./CommandPalette";
import ShortcutsOverlay from "./ShortcutsOverlay";
import PageHero from "./ui/PageHero";
import EventTicker from "./ui/EventTicker";
import Celebration from "./ui/Celebration";

export default function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const pageAccent = ACCENTS[accentForPath(pathname)].base;
  return (
    <MissionProvider>
      <div className="relative min-h-dvh" style={{ "--page-accent": pageAccent } as CSSProperties}>
        {/* ambient layers — page-tint re-colors the sky to the current page's accent */}
        <div aria-hidden className="nebula pointer-events-none fixed inset-0" />
        <div aria-hidden className="page-tint pointer-events-none fixed inset-0" />
        <div aria-hidden className="grid-bg pointer-events-none fixed inset-0" />

        <CommandPalette />
        <ShortcutsOverlay />
        <Celebration />
        <div className="relative mx-auto flex min-h-dvh w-full max-w-[1600px] flex-col gap-4 p-4 lg:p-5">
          <Header />
          <ApprovalsBar />
          <div className="flex flex-1 flex-col gap-4 md:flex-row">
            <Sidebar />
            <main className="min-w-0 flex-1">
              <PageHero />
              {children}
            </main>
          </div>
          <footer className="flex items-center justify-between gap-4 px-1 font-mono text-[10px] tracking-[0.2em] text-ink-faint">
            <EventTicker />
            <span className="shrink-0">BRIDGE: claude -p · SSE RELAY</span>
          </footer>
        </div>
      </div>
    </MissionProvider>
  );
}
