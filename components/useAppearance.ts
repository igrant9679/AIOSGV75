"use client";

import { useCallback, useEffect, useState } from "react";
import {
  APPEARANCE_DEFAULTS,
  APPEARANCE_EVENT,
  APPEARANCE_OPTIONS,
  APPEARANCE_STORAGE_KEY,
  THEME_STORAGE_KEY,
  sanitizeAppearance,
  type Appearance,
  type ThemeChoice,
} from "@/lib/appearance";

/** Client side of lib/appearance.ts: read, save and apply look-and-feel settings. */

export function readAppearance(): Appearance {
  try {
    return sanitizeAppearance(JSON.parse(localStorage.getItem(APPEARANCE_STORAGE_KEY) || "{}"));
  } catch {
    return { ...APPEARANCE_DEFAULTS };
  }
}

export function readThemeChoice(): ThemeChoice {
  try {
    const t = localStorage.getItem(THEME_STORAGE_KEY);
    return t === "light" || t === "system" ? t : "dark";
  } catch {
    return "dark";
  }
}

function systemTheme(): "dark" | "light" {
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function applyTheme(choice: ThemeChoice): void {
  document.documentElement.dataset.theme = choice === "system" ? systemTheme() : choice;
}

export function applyAppearance(a: Appearance): void {
  const root = document.documentElement;
  for (const o of APPEARANCE_OPTIONS) root.setAttribute(`data-${o.attr}`, a[o.key]);
}

export function saveAppearance(a: Appearance, theme?: ThemeChoice): void {
  try {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(a));
    if (theme) localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* private mode — still applies for this tab */
  }
  applyAppearance(a);
  if (theme) applyTheme(theme);
  window.dispatchEvent(new Event(APPEARANCE_EVENT));
}

/** Live appearance state; re-reads whenever any component (or another tab) changes it. */
export function useAppearance() {
  const [appearance, setAppearance] = useState<Appearance>(APPEARANCE_DEFAULTS);
  const [theme, setThemeState] = useState<ThemeChoice>("dark");

  useEffect(() => {
    const sync = () => {
      setAppearance(readAppearance());
      setThemeState(readThemeChoice());
    };
    sync();
    const onStorage = (e: StorageEvent) => {
      if (e.key !== APPEARANCE_STORAGE_KEY && e.key !== THEME_STORAGE_KEY) return;
      const a = readAppearance();
      applyAppearance(a);
      applyTheme(readThemeChoice());
      sync();
    };
    // "Match system" follows the OS live
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onScheme = () => {
      if (readThemeChoice() === "system") {
        applyTheme("system");
        window.dispatchEvent(new Event(APPEARANCE_EVENT));
      }
    };
    window.addEventListener(APPEARANCE_EVENT, sync);
    window.addEventListener("storage", onStorage);
    mq.addEventListener("change", onScheme);
    return () => {
      window.removeEventListener(APPEARANCE_EVENT, sync);
      window.removeEventListener("storage", onStorage);
      mq.removeEventListener("change", onScheme);
    };
  }, []);

  const update = useCallback((patch: Partial<Appearance>, nextTheme?: ThemeChoice) => {
    const next = { ...readAppearance(), ...patch };
    saveAppearance(next, nextTheme);
  }, []);

  return { appearance, theme, update };
}
