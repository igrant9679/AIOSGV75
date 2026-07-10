import {
  listSchedules,
  createSchedule,
  setEnabled,
  deleteSchedule,
  runScheduleNow,
  type Frequency,
  type Delivery,
} from "@/lib/schedules";
import type { MissionStrategy } from "@/lib/missions";
import { readRegistry } from "@/lib/registry";
import { AGENT_DEFS } from "@/lib/agents-config";

export const dynamic = "force-dynamic";

const STRATEGIES = new Set<MissionStrategy>(["single", "moa", "pipeline"]);
const FREQS = new Set<Frequency>(["hourly", "daily", "weekly"]);
const DELIVERIES = new Set<Delivery>(["vault", "telegram"]);
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function GET() {
  return Response.json({ schedules: await listSchedules() });
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    title?: string;
    prompt?: string;
    strategy?: MissionStrategy;
    agentIds?: string[];
    synthesizerId?: string;
    freq?: Frequency;
    time?: string;
    weekday?: number;
    deliver?: Delivery;
  };

  const prompt = (body.prompt ?? "").toString().trim();
  if (!prompt) return Response.json({ error: "prompt is required" }, { status: 400 });
  if (!body.strategy || !STRATEGIES.has(body.strategy)) {
    return Response.json({ error: "bad strategy" }, { status: 400 });
  }
  if (!body.freq || !FREQS.has(body.freq)) return Response.json({ error: "bad frequency" }, { status: 400 });
  const time = body.time ?? "09:00";
  if (!TIME_RE.test(time)) return Response.json({ error: "time must be HH:MM" }, { status: 400 });
  const deliver = body.deliver && DELIVERIES.has(body.deliver) ? body.deliver : "vault";

  const reg = await readRegistry();
  const known = new Set([
    "claude",
    ...AGENT_DEFS.map((d) => d.id),
    ...reg.commandAgents.map((a) => a.id),
    ...reg.llms.map((l) => l.id),
  ]);
  const agentIds = (body.agentIds ?? []).filter((id) => known.has(id)).slice(0, 6);
  if (agentIds.length === 0) return Response.json({ error: "pick at least one valid agent" }, { status: 400 });
  if (body.strategy !== "single" && agentIds.length < 2) {
    return Response.json({ error: `${body.strategy} needs at least 2 agents` }, { status: 400 });
  }
  const synthesizerId = body.synthesizerId && known.has(body.synthesizerId) ? body.synthesizerId : undefined;
  if (body.strategy === "moa" && !synthesizerId) {
    return Response.json({ error: "moa needs a synthesizer" }, { status: 400 });
  }

  const schedule = await createSchedule({
    title: body.title,
    prompt,
    strategy: body.strategy,
    agentIds,
    synthesizerId,
    freq: body.freq,
    time,
    weekday: typeof body.weekday === "number" ? Math.min(6, Math.max(0, body.weekday)) : undefined,
    deliver,
  });
  return Response.json({ ok: true, id: schedule.id, nextRun: schedule.nextRun });
}

export async function PATCH(request: Request) {
  const body = (await request.json()) as { id?: string; enabled?: boolean; runNow?: boolean };
  if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
  if (body.runNow) {
    const ok = await runScheduleNow(body.id);
    return Response.json(ok ? { ok: true } : { error: "not found or already running" }, { status: ok ? 200 : 400 });
  }
  if (typeof body.enabled === "boolean") {
    const ok = await setEnabled(body.id, body.enabled);
    return Response.json(ok ? { ok: true } : { error: "not found" }, { status: ok ? 200 : 404 });
  }
  return Response.json({ error: "nothing to do" }, { status: 400 });
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });
  await deleteSchedule(id);
  return Response.json({ ok: true });
}
