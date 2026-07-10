/** POST JSON and consume the SSE-framed streaming response. */
export async function streamSSE(
  url: string,
  body: unknown,
  onEvent: (data: Record<string, unknown>) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = ((await res.json()) as { error?: string }).error ?? detail;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(detail);
  }
  if (!res.body) throw new Error("no response stream");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const line = frame.trim();
      if (!line.startsWith("data:")) continue;
      try {
        onEvent(JSON.parse(line.slice(5).trim()));
      } catch {
        /* skip malformed frame */
      }
    }
  }
}
