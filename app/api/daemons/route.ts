import { daemonStatus, startDaemon } from "@/lib/daemons";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  return Response.json({ services: await daemonStatus() });
}

export async function POST(request: Request) {
  const body = (await request.json()) as { id?: string };
  if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
  const result = await startDaemon(body.id);
  // `building` isn't a failure — the slow self-healing path is under way.
  const status = result.ok ? 200 : result.building ? 202 : 500;
  return Response.json(result, { status });
}
