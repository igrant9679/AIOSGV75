import { clusterStatus, writeConfig, claimMaster, releaseMaster, forgetNode, clusterTick, type Role } from "@/lib/cluster";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await clusterStatus());
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    action?: string;
    enabled?: boolean;
    role?: Role;
    installDir?: string;
    label?: string;
    host?: string;
  };
  try {
    if (body.action === "config") {
      await writeConfig({ enabled: body.enabled, role: body.role, installDir: body.installDir, label: body.label });
      await clusterTick(); // heartbeat + elect immediately so the UI reflects it
      return Response.json(await clusterStatus());
    }
    if (body.action === "claim") {
      await claimMaster();
      return Response.json(await clusterStatus());
    }
    if (body.action === "release") {
      await releaseMaster();
      return Response.json(await clusterStatus());
    }
    if (body.action === "forget") {
      if (!body.host) return Response.json({ error: "host required" }, { status: 400 });
      await forgetNode(body.host);
      return Response.json(await clusterStatus());
    }
    return Response.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
