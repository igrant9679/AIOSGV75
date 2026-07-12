import os from "os";
import fs from "fs/promises";
import path from "path";
import { cpuUsagePercent, getClaudeVersion } from "@/lib/system";
import type { SystemStats } from "@/lib/types";

export const dynamic = "force-dynamic";

async function diskStats(): Promise<{ used?: number; total?: number }> {
  try {
    const st = await fs.statfs(process.cwd());
    const total = st.bsize * st.blocks;
    return { used: total - st.bsize * st.bfree, total };
  } catch {
    return {};
  }
}

async function dataStoreBytes(): Promise<number | undefined> {
  try {
    const dir = path.join(process.cwd(), "data");
    const entries = await fs.readdir(dir);
    let sum = 0;
    for (const name of entries) {
      try {
        sum += (await fs.stat(path.join(dir, name))).size;
      } catch {
        /* skip */
      }
    }
    return sum;
  } catch {
    return undefined;
  }
}

export async function GET() {
  const [disk, dataBytes, claudeVersion] = await Promise.all([diskStats(), dataStoreBytes(), getClaudeVersion()]);
  const stats: SystemStats = {
    cpu: cpuUsagePercent(),
    memUsed: os.totalmem() - os.freemem(),
    memTotal: os.totalmem(),
    uptime: os.uptime(),
    platform: `${os.type()} ${os.release()}`,
    hostname: os.hostname(),
    claudeVersion,
    diskUsed: disk.used,
    diskTotal: disk.total,
    dataBytes,
  };
  return Response.json(stats);
}
