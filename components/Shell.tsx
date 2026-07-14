"use client";

import type { ReactNode } from "react";
import { MissionProvider } from "./store";
import Header from "./Header";
import Sidebar from "./Sidebar";
import ApprovalsBar from "./ApprovalsBar";
import CommandPalette from "./CommandPalette";

export default function Shell({ children }: { children: ReactNode }) {
  return (
    <MissionProvider>
      <div className="relative min-h-dvh">
        {/* ambient layers */}
        <div aria-hidden className="nebula pointer-events-none fixed inset-0" />
        <div aria-hidden className="grid-bg pointer-events-none fixed inset-0" />

        <CommandPalette />
        <div className="relative mx-auto flex min-h-dvh w-full max-w-[1600px] flex-col gap-4 p-4 lg:p-5">
          <Header />
          <ApprovalsBar />
          <div className="flex flex-1 flex-col gap-4 md:flex-row">
            <Sidebar />
            <main className="min-w-0 flex-1">{children}</main>
          </div>
          <footer className="flex items-center justify-between px-1 font-mono text-[10px] tracking-[0.2em] text-ink-faint">
            <span>MISSION CONTROL · LOCAL DECK</span>
            <span>BRIDGE: claude -p · SSE RELAY</span>
          </footer>
        </div>
      </div>
    </MissionProvider>
  );
}
