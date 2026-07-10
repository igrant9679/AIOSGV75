import os from "os";
import { cpuUsagePercent, getClaudeVersion } from "@/lib/system";
import type { SystemStats } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const stats: SystemStats = {
    cpu: cpuUsagePercent(),
    memUsed: os.totalmem() - os.freemem(),
    memTotal: os.totalmem(),
    uptime: os.uptime(),
    platform: `${os.type()} ${os.release()}`,
    hostname: os.hostname(),
    claudeVersion: await getClaudeVersion(),
  };
  return Response.json(stats);
}
