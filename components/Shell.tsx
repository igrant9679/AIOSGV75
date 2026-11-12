"use client";

import type { CSSProperties, ReactNode } from "react";
import { usePathname } from "next/navigation";
import { MotionConfig } from "framer-motion";
import { useAppearance } from "./useAppearance";
import { ACCENTS, ROUTE_ACCENTS, type Accent } from "@/lib/accents";
import { MissionProvider, useMission } from "./store";
import Header from "./Header";
import Sidebar from "./Sidebar";
import ApprovalsBar from "./ApprovalsBar";
import CommandPalette from "./CommandPalette";
import ShortcutsOverlay from "./ShortcutsOverlay";
import PageHero from "./ui/PageHero";
import EventTicker from "./ui/EventTicker";
import Celebration from "./ui/Celebration";
import { SessionAlertsWatcher } from "./hub/NetworkPanels";
import PermissionPrompts from "./hub/PermissionPrompts";

/** Agent chat routes get a FULL theme takeover — the whole sky in their color. */
const TAKEOVER_ROUTES = new Set(["/auto", "/claude", "/openclaw", "/hermes"]);

/**
 * Inside MissionProvider so dynamic /agent/<id> pages can resolve their real
 * accent from the registry (ROUTE_ACCENTS only knows the static routes).
 */
function DeckFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { registry } = useMission();

  const agentId = pathname.startsWith("/agent/") ? pathname.split("/")[2] : null;
  let accent: Accent | undefined = ROUTE_ACCENTS[pathname];
  if (!accent && agentId) {
    accent =
      registry.llms.find((l) => l.id === agentId)?.accent ??
      registry.commandAgents.find((a) => a.id === agentId)?.accent;
  }
  const pageAccent = ACCENTS[accent ?? "cyan"].base;
  const takeover = TAKEOVER_ROUTES.has(pathname) || Boolean(agentId);

  return (
    <div
      className={`relative min-h-dvh ${takeover ? "theme-takeover" : ""}`}
      style={{ "--page-accent": pageAccent } as CSSProperties}
    >
      {/* ambient layers — page-tint washes the accent in everywhere; on agent
          chat pages the multicolor nebula crossfades out and a monochrome
          accent nebula takes the whole sky */}
      <div aria-hidden className="ambient">
        <div className="nebula pointer-events-none fixed inset-0" />
        <div className="nebula-accent pointer-events-none fixed inset-0" />
        <div className="page-tint pointer-events-none fixed inset-0" />
        <div className="grid-bg pointer-events-none fixed inset-0" />
      </div>

      <CommandPalette />
      <ShortcutsOverlay />
      <Celebration />
      <div className="deck-frame relative mx-auto flex min-h-dvh w-full max-w-[1600px] flex-col gap-4 p-4 lg:p-5">
        <Header />
        <ApprovalsBar />
        <div className="deck-row flex flex-1 flex-col gap-4 md:flex-row">
          <Sidebar />
          <main className="min-w-0 flex-1">
            <PageHero />
            {children}
          </main>
        </div>
        <footer className="deck-footer flex items-center justify-between gap-4 px-1 font-mono text-[10px] tracking-[0.2em] text-ink-faint">
          <EventTicker />
          <span className="shrink-0">BRIDGE: claude -p · SSE RELAY</span>
        </footer>
      </div>
    </div>
  );
}

export default function Shell({ children }: { children: ReactNode }) {
  // Animation setting also governs framer-motion: "reduced"/"none" skip
  // transform animations (fades remain), alongside the CSS rules in globals.css.
  const { appearance } = useAppearance();
  const reduce = appearance.motion !== "full";
  return (
    <MotionConfig reducedMotion={reduce ? "always" : "user"}>
      <MissionProvider>
        <DeckFrame>{children}</DeckFrame>
        <SessionAlertsWatcher />
        <PermissionPrompts />
      </MissionProvider>
    </MotionConfig>
  );
}
