import { readTasks, writeTasks, newTaskId, BOARD_STATUSES, type BoardStatus, type BoardTask } from "@/lib/tasks";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ tasks: await readTasks() });
}

export async function POST(request: Request) {
  const body = (await request.json()) as { title?: string; status?: BoardStatus };
  const title = (body.title ?? "").toString().trim().slice(0, 200);
  if (!title) return Response.json({ error: "title is required" }, { status: 400 });
  const status = BOARD_STATUSES.includes(body.status as BoardStatus) ? (body.status as BoardStatus) : "pending";
  const tasks = await readTasks();
  const task: BoardTask = { id: newTaskId(), title, status, createdAt: Date.now(), updatedAt: Date.now() };
  tasks.unshift(task);
  await writeTasks(tasks);
  return Response.json({ ok: true, task });
}

export async function PATCH(request: Request) {
  const body = (await request.json()) as { id?: string; status?: BoardStatus; title?: string };
  if (!body.id) return Response.json({ error: "id required" }, { status: 400 });
  const tasks = await readTasks();
  const task = tasks.find((t) => t.id === body.id);
  if (!task) return Response.json({ error: "not found" }, { status: 404 });
  if (body.status && BOARD_STATUSES.includes(body.status)) task.status = body.status;
  if (typeof body.title === "string" && body.title.trim()) task.title = body.title.trim().slice(0, 200);
  task.updatedAt = Date.now();
  await writeTasks(tasks);
  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });
  await writeTasks((await readTasks()).filter((t) => t.id !== id));
  return Response.json({ ok: true });
}
