import fs from "fs/promises";
import path from "path";
import { vaultInfo, vaultAvailable } from "@/lib/vault";
import { collectVaultFiles } from "@/lib/vaultSearch";

export const dynamic = "force-dynamic";

const MAX_NOTE_BYTES = 200_000;

/**
 * Content library over the vault's "Agentic OS/" tree.
 *   GET            → list all notes: { notes: [{ path, folder, name, mtime, size }] }
 *   GET ?path=rel  → read one note: { path, content } (path is relative to "Agentic OS/")
 */
export async function GET(request: Request) {
  if (!(await vaultAvailable())) return Response.json({ error: "vault not available" }, { status: 503 });
  const { base } = vaultInfo();
  const rel = new URL(request.url).searchParams.get("path");

  if (rel) {
    const abs = path.normalize(path.join(base, rel));
    if (!abs.startsWith(path.normalize(base + path.sep))) {
      return Response.json({ error: "path escapes vault" }, { status: 400 });
    }
    try {
      const content = await fs.readFile(abs, "utf8");
      return Response.json({ path: rel, content: content.slice(0, MAX_NOTE_BYTES) });
    } catch {
      return Response.json({ error: "not found" }, { status: 404 });
    }
  }

  const files = await collectVaultFiles(base);
  const notes = await Promise.all(
    files.map(async (abs) => {
      try {
        const st = await fs.stat(abs);
        const relPath = path.relative(base, abs).replace(/\\/g, "/");
        const parts = relPath.split("/");
        return {
          path: relPath,
          folder: parts.length > 1 ? parts[0] : "(root)",
          name: parts[parts.length - 1].replace(/\.md$/, ""),
          mtime: st.mtimeMs,
          size: st.size,
        };
      } catch {
        return null;
      }
    })
  );
  const clean = notes.filter(Boolean) as NonNullable<(typeof notes)[number]>[];
  clean.sort((a, b) => b.mtime - a.mtime);
  return Response.json({ notes: clean });
}
