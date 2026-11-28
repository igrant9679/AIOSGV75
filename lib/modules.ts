import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { vaultAvailable, vaultInfo } from "./vault";
import { MODULES, type ModuleDef } from "./moduleList";

/**
 * Modules (/modules, rule 53): whole features the owner can switch off and on. A module is a set of pages
 * (their menu entries disappear when it is off, and the page says so) and, for some, a background duty that
 * stops too (LevelUp's minute-by-minute check). The choice is one vault file
 * (Agentic OS/Cluster/modules.json), so every machine agrees. Nothing is deleted by switching one off.
 */

const file = () => path.join(vaultInfo().base, "Cluster", "modules.json");

export function readModuleState(): Record<string, boolean> {
  try {
    const j = JSON.parse(fs.readFileSync(file(), "utf8"));
    return j && typeof j.off === "object" && j.off ? Object.fromEntries(Object.keys(j.off).map((k) => [k, false])) : {};
  } catch {
    return {};
  }
}
export const moduleOn = (id: string): boolean => readModuleState()[id] !== false;
export function modulesView(): (ModuleDef & { on: boolean })[] {
  const st = readModuleState();
  return MODULES.map((m) => ({ ...m, on: st[m.id] !== false }));
}
export async function setModule(id: string, on: boolean): Promise<(ModuleDef & { on: boolean })[]> {
  if (!MODULES.some((m) => m.id === id)) throw new Error("No such module.");
  if (!(await vaultAvailable())) throw new Error("The vault isn't available on this machine.");
  const off = Object.fromEntries(Object.entries(readModuleState()).filter(([, v]) => v === false).map(([k]) => [k, true]));
  if (on) delete off[id];
  else off[id] = true;
  const f = file();
  await fsp.mkdir(path.dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify({ v: 1, off }, null, 1), "utf8");
  for (let i = 0; ; i++) {
    try {
      await fsp.rename(tmp, f);
      break;
    } catch (e) {
      if (i >= 8) throw e;
      await new Promise((r) => setTimeout(r, 250 * (i + 1)));
    }
  }
  return modulesView();
}
