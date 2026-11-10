"use client";

import { useEffect, useState } from "react";

/** What the browser needs from this network's settings (see lib/netSettings.ts). */
export interface NetView {
  hasFile: boolean;
  file: string;
  networkName: string;
  ownerName: string;
  appName: string;
  appTagline: string;
  productName: string;
  obsidianVault: string;
  vaultRoot: string;
  vaultOk: boolean;
  host: string;
  telegram: { tokenSet: boolean; tokenMasked: string; tokenFrom: string | null; chatId: string; chatIdFrom: string | null };
}

export const NET_DEFAULTS = {
  appName: "AI OPERATIONS CONTROL",
  appTagline: "LOCAL AI OPERATIONS DECK",
  productName: "Mission Control",
  obsidianVault: "IdrisGV75",
};

// one shared copy for every component on the page
let current: NetView | null = null;
let inflight: Promise<NetView | null> | null = null;
const listeners = new Set<(v: NetView | null) => void>();

export function refreshNetSettings(): Promise<NetView | null> {
  inflight = fetch("/api/network-settings", { cache: "no-store" })
    .then((r) => (r.ok ? (r.json() as Promise<NetView>) : null))
    .catch(() => null)
    .then((v) => {
      if (v) current = v;
      inflight = null;
      listeners.forEach((l) => l(current));
      return current;
    });
  return inflight;
}

/** Shared network settings; `null` until loaded. Use NET_DEFAULTS while it is. */
export function useNetSettings(): NetView | null {
  const [v, setV] = useState<NetView | null>(current);
  useEffect(() => {
    listeners.add(setV);
    if (!current && !inflight) void refreshNetSettings();
    else if (current) setV(current);
    return () => {
      listeners.delete(setV);
    };
  }, []);
  return v;
}

/** The product's name in running text, e.g. in the Guide. */
export function useProductName(): string {
  return useNetSettings()?.productName || NET_DEFAULTS.productName;
}

/** Swap the default product name for this network's, in help text written as "Mission Control". */
export function brandText(text: string, product: string): string {
  return product === NET_DEFAULTS.productName ? text : text.split(NET_DEFAULTS.productName).join(product);
}

/** Obsidian vault name for obsidian:// links (the vault folder's name). */
export function useObsidianVault(): string {
  return useNetSettings()?.obsidianVault || NET_DEFAULTS.obsidianVault;
}
