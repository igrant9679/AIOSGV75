"use client";

import { useEffect, useState } from "react";

/** useState persisted to localStorage (SSR-safe: initial render uses the default). */
export function useLocalStorageState<T extends string>(key: string, initial: T) {
  const [value, setValue] = useState<T>(initial);

  useEffect(() => {
    const stored = window.localStorage.getItem(key);
    if (stored !== null) setValue(stored as T);
  }, [key]);

  useEffect(() => {
    window.localStorage.setItem(key, value);
  }, [key, value]);

  return [value, setValue] as const;
}
