import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { vaultAvailable, vaultInfo } from "./vault";
import { sanitizeAppearance, type Appearance } from "./appearance";
import { cleanLook, type CustomLook } from "./lookCustom";

/**
 * The fleet look: one appearance the owner pushes to every machine (Appearance → Push to the whole
 * Fleet). Looks are kept per browser (localStorage), so a push is a file in the vault
 * (Agentic OS/Cluster/look.json) that every machine serves at /api/look; each browser applies a new
 * version ONCE (components/FleetLookSync.tsx) unless it chose to keep its own look. After that the
 * browser is free to change again until the next push.
 *
 * Safe to share through the vault: it holds only appearance values, and both ends clean them
 * (sanitizeAppearance, cleanLook; the CSS builder validates again), so a hand-edited file can't inject
 * anything. A background picture rides along (a few MB at most).
 */

export interface FleetLook {
  v: 1;
  /** a new number on every push; browsers remember the last one they applied */
  version: number;
  at: number;
  by: string;
  host: string;
  name?: string;
  appearance: Appearance;
  theme?: "dark" | "light" | "system";
  custom: CustomLook;
}

const file = () => path.join(vaultInfo().base, "Cluster", "look.json");

export function readFleetLook(): FleetLook | null {
  try {
    const j = JSON.parse(fs.readFileSync(file(), "utf8"));
    if (!j || typeof j.version !== "number") return null;
    return {
      v: 1,
      version: j.version,
      at: Number(j.at) || 0,
      by: String(j.by ?? "").slice(0, 60),
      host: String(j.host ?? "").slice(0, 80),
      name: typeof j.name === "string" ? j.name.slice(0, 40) : undefined,
      appearance: sanitizeAppearance(j.appearance),
      theme: ["dark", "light", "system"].includes(j.theme) ? j.theme : undefined,
      custom: cleanLook(j.custom),
    };
  } catch {
    return null;
  }
}

async function replace(f: string, text: string) {
  await fsp.mkdir(path.dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, text, "utf8");
  // the vault is a OneDrive folder: a rename can be refused for a moment (rule 24)
  for (let i = 0; ; i++) {
    try {
      await fsp.rename(tmp, f);
      return;
    } catch (e) {
      if (i >= 8) {
        await fsp.rm(tmp, { force: true }).catch(() => {});
        throw e;
      }
      await new Promise((r) => setTimeout(r, 250 * (i + 1)));
    }
  }
}

export async function pushFleetLook(input: { appearance: unknown; theme?: unknown; custom: unknown; name?: unknown; by: string }): Promise<FleetLook> {
  if (!(await vaultAvailable())) throw new Error("The vault isn't available on this machine, so the look can't reach the others.");
  const look: FleetLook = {
    v: 1,
    version: Date.now(),
    at: Date.now(),
    by: input.by.slice(0, 60),
    host: os.hostname(),
    name: typeof input.name === "string" && input.name.trim() ? input.name.trim().slice(0, 40) : undefined,
    appearance: sanitizeAppearance(input.appearance),
    theme: ["dark", "light", "system"].includes(String(input.theme)) ? (input.theme as FleetLook["theme"]) : undefined,
    custom: cleanLook(input.custom),
  };
  const text = JSON.stringify(look);
  if (text.length > 6_000_000) throw new Error("That look is too big to share (the background picture). Use a smaller picture.");
  await replace(file(), text);
  return look;
}

/** Stop sharing: browsers keep whatever they have; nothing new is applied. */
export async function clearFleetLook(): Promise<void> {
  await fsp.rm(file(), { force: true });
}
