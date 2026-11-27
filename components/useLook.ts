"use client";

import { useCallback, useEffect, useState } from "react";
import { EMPTY_LOOK, LOOK_EVENT, LOOK_STORAGE_KEY, LOOKS_SAVED_KEY, buildLookCss, cleanLook, type CustomLook, type SavedLook } from "@/lib/lookCustom";

/** Client side of lib/lookCustom.ts: read, save and apply the custom look (this browser). */

export function readLook(): CustomLook {
  try {
    return cleanLook(JSON.parse(localStorage.getItem(LOOK_STORAGE_KEY) || "null"));
  } catch {
    return { ...EMPTY_LOOK };
  }
}

export function applyLook(look: CustomLook): void {
  const css = buildLookCss(look);
  let el = document.getElementById("mc-look-custom") as HTMLStyleElement | null;
  if (!css) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement("style");
    el.id = "mc-look-custom";
    document.head.appendChild(el);
  }
  if (el.textContent !== css) el.textContent = css;
}

/** Save (and apply). Returns false when the browser refused (a picture too big for its storage). */
export function saveLook(look: CustomLook): boolean {
  const clean = cleanLook(look);
  let ok = true;
  try {
    if (Object.keys(clean).length <= 1) localStorage.removeItem(LOOK_STORAGE_KEY);
    else localStorage.setItem(LOOK_STORAGE_KEY, JSON.stringify(clean));
  } catch {
    ok = false;
  }
  applyLook(clean);
  window.dispatchEvent(new Event(LOOK_EVENT));
  return ok;
}

export function readSavedLooks(): SavedLook[] {
  try {
    const v = JSON.parse(localStorage.getItem(LOOKS_SAVED_KEY) || "[]");
    return Array.isArray(v) ? v.filter((x) => x && typeof x.name === "string" && x.custom).slice(0, 30) : [];
  } catch {
    return [];
  }
}
export function writeSavedLooks(list: SavedLook[]): boolean {
  try {
    localStorage.setItem(LOOKS_SAVED_KEY, JSON.stringify(list.slice(0, 30)));
    return true;
  } catch {
    return false;
  }
}

/** Live custom look; re-reads whenever any component (or another tab) changes it. */
export function useLook() {
  const [look, setLookState] = useState<CustomLook>(EMPTY_LOOK);
  useEffect(() => {
    const sync = () => setLookState(readLook());
    sync();
    const onStorage = (e: StorageEvent) => {
      if (e.key !== LOOK_STORAGE_KEY) return;
      const l = readLook();
      applyLook(l);
      setLookState(l);
    };
    window.addEventListener(LOOK_EVENT, sync);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(LOOK_EVENT, sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  const setLook = useCallback((next: CustomLook | ((cur: CustomLook) => CustomLook)) => {
    const value = typeof next === "function" ? next(readLook()) : next;
    const ok = saveLook(value);
    setLookState(readLook());
    return ok;
  }, []);
  return { look, setLook };
}
