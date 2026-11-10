import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";

/**
 * Small, careful edits to this machine's .env.local (one KEY=value line each),
 * keeping every other line and comment as it was. Values take effect after a restart.
 */
const ENV_FILE = () => path.join(process.cwd(), ".env.local");

export async function setEnvVar(key: string, value: string): Promise<void> {
  if (!/^[A-Z][A-Z0-9_]*$/.test(key)) throw new Error(`bad env key ${key}`);
  if (/[\r\n]/.test(value)) throw new Error("value can't contain line breaks");
  let text = "";
  try {
    text = await fs.readFile(ENV_FILE(), "utf8");
  } catch {
    /* new file */
  }
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text ? text.split(/\r?\n/) : [];
  const line = `${key}=${value}`;
  const i = lines.findIndex((l) => l.trim().startsWith(`${key}=`));
  if (i >= 0) lines[i] = line;
  else {
    while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
    lines.push(line, "");
  }
  await fs.writeFile(ENV_FILE(), lines.join(eol), "utf8");
}

/**
 * Restart Mission Control so .env.local changes apply.
 * Windows: leave data\watchdog.restart and run the "Mission Control Watchdog" task, which
 * stops this server and starts a fresh one. (A helper spawned from here can't do it:
 * Windows ends it together with this process.) Mac: exit, and launchd's KeepAlive
 * starts it again. Returns false when there's no supervisor to bring it back.
 */
export async function restartSelf(): Promise<boolean> {
  if (process.platform === "win32") {
    const marker = path.join(process.cwd(), "data", "watchdog.restart");
    await fs.mkdir(path.dirname(marker), { recursive: true });
    await fs.writeFile(marker, new Date().toISOString(), "utf8");
    const ok = await new Promise<boolean>((resolve) => {
      const p = spawn("schtasks.exe", ["/Run", "/TN", "Mission Control Watchdog"], { windowsHide: true, stdio: "ignore" });
      p.on("close", (c) => resolve(c === 0));
      p.on("error", () => resolve(false));
    });
    if (!ok) await fs.rm(marker, { force: true });
    return ok;
  }
  if (process.platform === "darwin") {
    setTimeout(() => process.exit(0), 1500);
    return true;
  }
  return false;
}
