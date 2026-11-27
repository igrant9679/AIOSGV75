"use client";

import { useEffect } from "react";
import { sanitizeAppearance, type ThemeChoice } from "@/lib/appearance";
import { cleanLook } from "@/lib/lookCustom";
import { saveAppearance } from "./useAppearance";
import { saveLook } from "./useLook";

/** localStorage: the fleet look version this browser last applied, and whether it follows at all. */
export const FLEET_APPLIED_KEY = "mc-look-fleet-applied";
export const FLEET_FOLLOW_KEY = "mc-look-fleet-follow";

export function followsFleet(): boolean {
  try {
    return localStorage.getItem(FLEET_FOLLOW_KEY) !== "off";
  } catch {
    return true;
  }
}
export function markApplied(version: number) {
  try {
    localStorage.setItem(FLEET_APPLIED_KEY, String(version));
  } catch {
    /* private mode */
  }
}

/** Apply a look pushed to the whole Fleet (lib/fleetLook.ts), once per push, unless this browser opted out. */
export async function checkFleetLook(force = false): Promise<boolean> {
  if (!force && !followsFleet()) return false;
  try {
    const meta = await (await fetch("/api/look?meta=1", { cache: "no-store" })).json();
    const v = meta?.look?.version;
    if (typeof v !== "number") return false;
    if (!force && localStorage.getItem(FLEET_APPLIED_KEY) === String(v)) return false;
    const { look } = await (await fetch("/api/look", { cache: "no-store" })).json();
    if (!look || look.version !== v) return false;
    saveAppearance(sanitizeAppearance(look.appearance), (["dark", "light", "system"].includes(look.theme) ? look.theme : undefined) as ThemeChoice | undefined);
    saveLook(cleanLook(look.custom));
    markApplied(v);
    return true;
  } catch {
    return false;
  }
}

/** Mounted once in the shell: checks at start, when the window comes back, and every 5 minutes. */
export default function FleetLookSync() {
  useEffect(() => {
    void checkFleetLook();
    const onFocus = () => void checkFleetLook();
    window.addEventListener("focus", onFocus);
    const t = setInterval(() => void checkFleetLook(), 5 * 60_000);
    return () => {
      window.removeEventListener("focus", onFocus);
      clearInterval(t);
    };
  }, []);
  return null;
}
