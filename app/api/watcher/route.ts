import { readConfig, writeConfig, listSweeps, runScan, type WatchChannel } from "@/lib/youtubeWatch";

export const dynamic = "force-dynamic";

export async function GET() {
  const [config, sweeps] = await Promise.all([readConfig(), listSweeps()]);
  return Response.json({ config, sweeps });
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    action?: "scan" | "config";
    channels?: WatchChannel[];
    keywords?: string[];
  };

  if (body.action === "scan") {
    const sweep = await runScan();
    if (!sweep) return Response.json({ error: "add at least one channel first (or a scan is already running)" }, { status: 400 });
    return Response.json({ ok: true, sweep });
  }

  // update watchlist
  const cfg = await readConfig();
  if (Array.isArray(body.channels)) {
    cfg.channels = body.channels
      .filter((c) => /^UC[\w-]{20,}$/.test(c.id ?? ""))
      .map((c) => ({ id: c.id, name: (c.name || c.id).slice(0, 60) }))
      .slice(0, 40);
  }
  if (Array.isArray(body.keywords)) {
    cfg.keywords = body.keywords.map((k) => k.toString().trim().slice(0, 40)).filter(Boolean).slice(0, 30);
  }
  await writeConfig(cfg);
  return Response.json({ ok: true, config: cfg });
}
