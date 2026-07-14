"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ACCENTS, type Accent } from "@/lib/accents";
import { PROVIDER_PRESETS } from "@/lib/providers";
import Panel from "./ui/Panel";
import ServiceKeysPanel from "./ServiceKeysPanel";
import Avatar from "./Avatar";
import StatusOrb from "./ui/StatusOrb";
import { IconCheck, IconPencil, IconPlus, IconTrash } from "./icons";
import { useMission } from "./store";

const ACCENT_CHOICES: Accent[] = ["cyan", "magenta", "amber", "lime", "violet", "rose"];

const inputCls =
  "h-10 w-full rounded-lg border border-line bg-panel-2 px-3 font-mono text-[12px] text-ink outline-none placeholder:text-ink-faint focus:border-line-bright";
const labelCls = "mb-1 block font-mono text-[10px] tracking-[0.14em] text-ink-faint";

function AccentPicker({ value, onChange }: { value: Accent; onChange: (a: Accent) => void }) {
  return (
    <div className="flex gap-1.5" role="radiogroup" aria-label="Accent color">
      {ACCENT_CHOICES.map((a) => (
        <button
          key={a}
          role="radio"
          aria-checked={value === a}
          aria-label={a}
          onClick={() => onChange(a)}
          className="h-7 w-7 cursor-pointer rounded-full transition-transform hover:scale-110"
          style={{
            background: ACCENTS[a].base,
            outline: value === a ? `2px solid ${ACCENTS[a].base}` : "none",
            outlineOffset: 2,
            opacity: value === a ? 1 : 0.45,
          }}
        />
      ))}
    </div>
  );
}

export default function SettingsSection() {
  const { registry, refreshRegistry, addEvent } = useMission();
  const router = useRouter();
  const [err, setErr] = useState("");

  // add-LLM form
  const [preset, setPreset] = useState("openrouter");
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState(PROVIDER_PRESETS[0].baseUrl);
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [accent, setAccent] = useState<Accent>("cyan");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [saving, setSaving] = useState(false);

  // inline LLM editing (apiKey blank = keep current; clearKey overrides)
  const emptyEdit = {
    name: "",
    provider: "",
    baseUrl: "",
    model: "",
    apiKey: "",
    systemPrompt: "",
    accent: "cyan" as Accent,
    clearKey: false,
  };
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState(emptyEdit);

  // add command agent form
  const [caName, setCaName] = useState("");
  const [caCmd, setCaCmd] = useState("");
  const [caTagline, setCaTagline] = useState("");
  const [caAccent, setCaAccent] = useState<Accent>("magenta");

  // workspace form
  const [wsName, setWsName] = useState("");

  // mcp servers
  interface McpServer {
    name: string;
    transport: "stdio" | "http";
    detail: string;
  }
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [mcpName, setMcpName] = useState("");
  const [mcpTransport, setMcpTransport] = useState<"stdio" | "http">("stdio");
  const [mcpValue, setMcpValue] = useState("");

  const loadMcp = useCallback(async () => {
    try {
      const res = await fetch("/api/mcp");
      if (res.ok) setMcpServers(((await res.json()) as { servers: McpServer[] }).servers ?? []);
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    loadMcp();
  }, [loadMcp]);

  const addMcp = async () => {
    setErr("");
    const res = await fetch("/api/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: mcpName,
        transport: mcpTransport,
        commandLine: mcpTransport === "stdio" ? mcpValue : undefined,
        url: mcpTransport === "http" ? mcpValue : undefined,
      }),
    });
    const json = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok || !json.ok) setErr(json.error ?? "failed to add MCP server");
    else {
      addEvent("SETTINGS", `MCP server added: ${mcpName}`, "cyan");
      setMcpName("");
      setMcpValue("");
      loadMcp();
    }
  };

  const pickPreset = (id: string) => {
    setPreset(id);
    const p = PROVIDER_PRESETS.find((x) => x.id === id);
    if (p) {
      setBaseUrl(p.baseUrl);
      if (!name || PROVIDER_PRESETS.some((x) => x.name === name)) setName(p.id === "custom" ? "" : p.name.split(" ")[0]);
      setModel(p.exampleModel);
    }
  };

  const post = async (kind: string, data: Record<string, unknown>): Promise<string | null> => {
    setErr("");
    setSaving(true);
    try {
      const res = await fetch("/api/registry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, data }),
      });
      const json = (await res.json()) as { ok?: boolean; id?: string; error?: string };
      if (!res.ok || !json.ok) {
        setErr(json.error ?? "save failed");
        return null;
      }
      await refreshRegistry();
      return json.id ?? null;
    } catch (e) {
      setErr((e as Error).message);
      return null;
    } finally {
      setSaving(false);
    }
  };

  const remove = async (kind: string, id: string) => {
    await fetch(`/api/registry?kind=${kind}&id=${encodeURIComponent(id)}`, { method: "DELETE" });
    await refreshRegistry();
    addEvent("SETTINGS", `Removed ${kind}: ${id}`, "rose");
  };

  const openEdit = (l: (typeof registry.llms)[number]) => {
    setEditingId(l.id);
    setEdit({
      name: l.name,
      provider: l.provider,
      baseUrl: l.baseUrl,
      model: l.model,
      apiKey: "",
      systemPrompt: l.systemPrompt ?? "",
      accent: l.accent,
      clearKey: false,
    });
  };

  const saveEdit = async (id: string) => {
    setErr("");
    setSaving(true);
    try {
      const data: Record<string, unknown> = {
        name: edit.name,
        provider: edit.provider,
        baseUrl: edit.baseUrl,
        model: edit.model,
        systemPrompt: edit.systemPrompt,
        accent: edit.accent,
      };
      if (edit.clearKey) data.apiKey = null;
      else if (edit.apiKey) data.apiKey = edit.apiKey;
      const res = await fetch("/api/registry", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "llm", id, data }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setErr(json.error ?? "update failed");
        return;
      }
      await refreshRegistry();
      addEvent("SETTINGS", `LLM updated: ${edit.name}`, edit.accent);
      setEditingId(null);
      setEdit(emptyEdit);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const addLlm = async () => {
    const id = await post("llm", { name, provider: preset, baseUrl, model, apiKey, accent, systemPrompt });
    if (id) {
      addEvent("SETTINGS", `LLM agent added: ${name}`, accent);
      setName("");
      setApiKey("");
      router.push(`/agent/${id}`);
    }
  };

  const addCommand = async () => {
    const id = await post("command", { name: caName, commandTemplate: caCmd, tagline: caTagline, accent: caAccent });
    if (id) {
      addEvent("SETTINGS", `Command agent added: ${caName}`, caAccent);
      setCaName("");
      setCaCmd("");
      setCaTagline("");
      router.push(`/agent/${id}`);
    }
  };

  const addWorkspace = async () => {
    const id = await post("workspace", { name: wsName });
    if (id) {
      addEvent("SETTINGS", `Workspace created: ${wsName}`, "lime");
      setWsName("");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {err && (
        <div role="alert" className="rounded-xl border border-neon-rose/30 bg-neon-rose/10 px-4 py-2.5 font-mono text-xs text-neon-rose">
          {err}
        </div>
      )}

      <Panel title="LLM Connections">
        <div className="grid gap-5 p-5 lg:grid-cols-2">
          {/* existing */}
          <div className="flex flex-col gap-2">
            {registry.llms.length === 0 && (
              <p className="py-6 text-center text-xs text-ink-faint">
                No LLM agents yet — add Kimi, DeepSeek, Grok, Gemini, or anything OpenAI-compatible.
              </p>
            )}
            {registry.llms.map((l) => (
              <div key={l.id} className="rounded-xl border border-line bg-white/[0.02] px-3 py-2.5">
                <div className="flex items-center gap-3">
                  <Avatar name={l.name} accent={l.accent} size={32} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink">{l.name}</p>
                    <p className="truncate font-mono text-[10px] text-ink-faint">
                      {l.provider} · {l.model}
                    </p>
                  </div>
                  <StatusOrb accent={l.hasKey ? "lime" : "rose"} pulsing={false} size={7} />
                  <button
                    onClick={() => (editingId === l.id ? setEditingId(null) : openEdit(l))}
                    aria-label={`Edit ${l.name}`}
                    aria-expanded={editingId === l.id}
                    className="cursor-pointer rounded-lg p-1.5 text-ink-faint transition-colors hover:bg-white/[0.06] hover:text-neon-cyan"
                  >
                    <IconPencil width={14} height={14} />
                  </button>
                  <button
                    onClick={() => remove("llm", l.id)}
                    aria-label={`Remove ${l.name}`}
                    className="cursor-pointer rounded-lg p-1.5 text-ink-faint transition-colors hover:bg-white/[0.06] hover:text-neon-rose"
                  >
                    <IconTrash width={14} height={14} />
                  </button>
                </div>
                {editingId === l.id && (
                  <div
                    className="mt-3 flex flex-col gap-3"
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setEditingId(null);
                    }}
                  >
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={labelCls} htmlFor={`edit-name-${l.id}`}>DISPLAY NAME</label>
                        <input id={`edit-name-${l.id}`} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} className={inputCls} autoFocus />
                      </div>
                      <div>
                        <label className={labelCls} htmlFor={`edit-model-${l.id}`}>MODEL ID</label>
                        <input id={`edit-model-${l.id}`} value={edit.model} onChange={(e) => setEdit({ ...edit, model: e.target.value })} className={inputCls} />
                      </div>
                    </div>
                    <div className="grid grid-cols-[1fr_2fr] gap-3">
                      <div>
                        <label className={labelCls} htmlFor={`edit-provider-${l.id}`}>PROVIDER</label>
                        <input id={`edit-provider-${l.id}`} value={edit.provider} onChange={(e) => setEdit({ ...edit, provider: e.target.value })} className={inputCls} />
                      </div>
                      <div>
                        <label className={labelCls} htmlFor={`edit-url-${l.id}`}>BASE URL</label>
                        <input id={`edit-url-${l.id}`} value={edit.baseUrl} onChange={(e) => setEdit({ ...edit, baseUrl: e.target.value })} className={inputCls} />
                      </div>
                    </div>
                    <div>
                      <label className={labelCls} htmlFor={`edit-key-${l.id}`}>
                        API KEY <span className="normal-case text-ink-faint">(leave blank to keep the current key)</span>
                      </label>
                      <input
                        id={`edit-key-${l.id}`}
                        type="password"
                        value={edit.apiKey}
                        onChange={(e) => setEdit({ ...edit, apiKey: e.target.value, clearKey: false })}
                        placeholder={l.hasKey ? "unchanged" : "no key set"}
                        autoComplete="off"
                        className={inputCls}
                        disabled={edit.clearKey}
                      />
                      <label className="mt-1.5 flex cursor-pointer items-center gap-2 font-mono text-[10px] tracking-[0.1em] text-ink-faint">
                        <input
                          type="checkbox"
                          checked={edit.clearKey}
                          onChange={(e) => setEdit({ ...edit, clearKey: e.target.checked, apiKey: "" })}
                          className="cursor-pointer accent-current"
                        />
                        REMOVE KEY (for keyless localhost endpoints)
                      </label>
                    </div>
                    <div>
                      <label className={labelCls} htmlFor={`edit-sys-${l.id}`}>SYSTEM PROMPT</label>
                      <textarea id={`edit-sys-${l.id}`} value={edit.systemPrompt} onChange={(e) => setEdit({ ...edit, systemPrompt: e.target.value })} rows={2} className={`${inputCls} h-auto resize-none py-2`} />
                    </div>
                    <div className="flex items-center justify-between">
                      <AccentPicker value={edit.accent} onChange={(a) => setEdit({ ...edit, accent: a })} />
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setEditingId(null)}
                          className="cursor-pointer rounded-lg border border-line px-3 py-2 text-xs text-ink-dim transition-colors hover:bg-white/[0.06]"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => saveEdit(l.id)}
                          disabled={saving || !edit.name.trim() || !edit.model.trim() || !edit.baseUrl.trim()}
                          aria-label={`Save changes to ${l.name}`}
                          className="flex cursor-pointer items-center gap-2 rounded-lg bg-gradient-to-br from-lime-600 to-neon-lime px-4 py-2 text-xs font-semibold text-black disabled:cursor-not-allowed disabled:opacity-35"
                        >
                          <IconCheck width={14} height={14} /> Save
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* add form */}
          <div className="flex flex-col gap-3 rounded-xl border border-line bg-white/[0.02] p-4">
            <p className="panel-title">Add LLM Agent</p>
            <div>
              <label className={labelCls} htmlFor="llm-provider">PROVIDER</label>
              <select id="llm-provider" value={preset} onChange={(e) => pickPreset(e.target.value)} className={`${inputCls} cursor-pointer`}>
                {PROVIDER_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls} htmlFor="llm-name">DISPLAY NAME</label>
                <input id="llm-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Kimi" className={inputCls} />
              </div>
              <div>
                <label className={labelCls} htmlFor="llm-model">MODEL ID</label>
                <input id="llm-model" value={model} onChange={(e) => setModel(e.target.value)} placeholder="kimi-k2-0905-preview" className={inputCls} />
              </div>
            </div>
            <div>
              <label className={labelCls} htmlFor="llm-url">BASE URL</label>
              <input id="llm-url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.example.com/v1" className={inputCls} />
            </div>
            <div>
              <label className={labelCls} htmlFor="llm-key">
                API KEY <span className="normal-case text-ink-faint">(stored locally in data/registry.json · get one at {PROVIDER_PRESETS.find((p) => p.id === preset)?.keyHint} · not needed for localhost endpoints like Ollama)</span>
              </label>
              <input id="llm-key" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-… (leave empty for localhost)" className={inputCls} autoComplete="off" />
            </div>
            <div>
              <label className={labelCls} htmlFor="llm-sys">SYSTEM PROMPT (OPTIONAL)</label>
              <textarea id="llm-sys" value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} rows={2} placeholder="Personality / instructions for this agent" className={`${inputCls} h-auto resize-none py-2`} />
            </div>
            <div className="flex items-center justify-between">
              <AccentPicker value={accent} onChange={setAccent} />
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={addLlm}
                disabled={saving || !name.trim() || !model.trim()}
                className="flex cursor-pointer items-center gap-2 rounded-lg bg-gradient-to-br from-cyan-600 to-neon-cyan px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-35"
              >
                <IconPlus width={15} height={15} /> Add LLM
              </motion.button>
            </div>
          </div>
        </div>
      </Panel>

      <ServiceKeysPanel />

      <Panel title="Command Agents" delay={0.05}>
        <div className="grid gap-5 p-5 lg:grid-cols-2">
          <div className="flex flex-col gap-2">
            <p className="text-xs leading-5 text-ink-faint">
              Built-ins: OpenClaw and Hermes. Add any local CLI as an agent — the command runs on this machine with your
              message piped to stdin, or substituted for <span className="font-mono text-neon-amber">{"{input}"}</span>.
            </p>
            {registry.commandAgents.map((a) => (
              <div key={a.id} className="flex items-center gap-3 rounded-xl border border-line bg-white/[0.02] px-3 py-2.5">
                <Avatar name={a.name} accent={a.accent} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink">{a.name}</p>
                  <p className="truncate font-mono text-[10px] text-ink-faint">{a.commandTemplate}</p>
                </div>
                <button
                  onClick={() => remove("command", a.id)}
                  aria-label={`Remove ${a.name}`}
                  className="cursor-pointer rounded-lg p-1.5 text-ink-faint transition-colors hover:bg-white/[0.06] hover:text-neon-rose"
                >
                  <IconTrash width={14} height={14} />
                </button>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-3 rounded-xl border border-line bg-white/[0.02] p-4">
            <p className="panel-title">Add Command Agent</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls} htmlFor="ca-name">NAME</label>
                <input id="ca-name" value={caName} onChange={(e) => setCaName(e.target.value)} placeholder="My Agent" className={inputCls} />
              </div>
              <div>
                <label className={labelCls} htmlFor="ca-tag">TAGLINE</label>
                <input id="ca-tag" value={caTagline} onChange={(e) => setCaTagline(e.target.value)} placeholder="What it does" className={inputCls} />
              </div>
            </div>
            <div>
              <label className={labelCls} htmlFor="ca-cmd">COMMAND TEMPLATE</label>
              <input id="ca-cmd" value={caCmd} onChange={(e) => setCaCmd(e.target.value)} placeholder='mycli chat --prompt {input}' className={inputCls} />
            </div>
            <div className="flex items-center justify-between">
              <AccentPicker value={caAccent} onChange={setCaAccent} />
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={addCommand}
                disabled={saving || !caName.trim() || !caCmd.trim()}
                className="flex cursor-pointer items-center gap-2 rounded-lg bg-gradient-to-br from-fuchsia-700 to-neon-magenta px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-35"
              >
                <IconPlus width={15} height={15} /> Add Agent
              </motion.button>
            </div>
          </div>
        </div>
      </Panel>

      <Panel title="MCP Servers — Claude Bridge" delay={0.08}>
        <div className="grid gap-5 p-5 lg:grid-cols-2">
          <div className="flex flex-col gap-2">
            <p className="text-xs leading-5 text-ink-faint">
              MCP servers give the dashboard&apos;s Claude extra tools (filesystem, browsers, databases…). They ride
              along on every Claude bridge run via <span className="font-mono text-neon-amber">--mcp-config</span>.
              Find servers at <span className="font-mono">github.com/modelcontextprotocol/servers</span>.
            </p>
            {mcpServers.map((s) => (
              <div key={s.name} className="flex items-center gap-3 rounded-xl border border-line bg-white/[0.02] px-3 py-2.5">
                <span className="rounded bg-neon-cyan/10 px-1.5 py-0.5 font-mono text-[9px] tracking-wide text-neon-cyan">
                  {s.transport.toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink">{s.name}</p>
                  <p className="truncate font-mono text-[10px] text-ink-faint">{s.detail}</p>
                </div>
                <button
                  onClick={async () => {
                    await fetch(`/api/mcp?name=${encodeURIComponent(s.name)}`, { method: "DELETE" });
                    loadMcp();
                  }}
                  aria-label={`Remove MCP server ${s.name}`}
                  className="cursor-pointer rounded-lg p-1.5 text-ink-faint transition-colors hover:bg-white/[0.06] hover:text-neon-rose"
                >
                  <IconTrash width={14} height={14} />
                </button>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-3 rounded-xl border border-line bg-white/[0.02] p-4">
            <p className="panel-title">Add MCP Server</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls} htmlFor="mcp-name">NAME</label>
                <input id="mcp-name" value={mcpName} onChange={(e) => setMcpName(e.target.value)} placeholder="filesystem" className={inputCls} />
              </div>
              <div>
                <label className={labelCls} htmlFor="mcp-transport">TRANSPORT</label>
                <select
                  id="mcp-transport"
                  value={mcpTransport}
                  onChange={(e) => setMcpTransport(e.target.value as "stdio" | "http")}
                  className={`${inputCls} cursor-pointer`}
                >
                  <option value="stdio">stdio (local command)</option>
                  <option value="http">http (remote URL)</option>
                </select>
              </div>
            </div>
            <div>
              <label className={labelCls} htmlFor="mcp-value">{mcpTransport === "stdio" ? "COMMAND" : "URL"}</label>
              <input
                id="mcp-value"
                value={mcpValue}
                onChange={(e) => setMcpValue(e.target.value)}
                placeholder={
                  mcpTransport === "stdio"
                    ? "npx -y @modelcontextprotocol/server-filesystem C:\\Users\\Admin\\Documents"
                    : "https://mcp.example.com/sse"
                }
                className={inputCls}
              />
            </div>
            <div className="flex justify-end">
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={addMcp}
                disabled={!mcpName.trim() || !mcpValue.trim()}
                className="flex cursor-pointer items-center gap-2 rounded-lg bg-gradient-to-br from-violet-700 to-neon-violet px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-35"
              >
                <IconPlus width={15} height={15} /> Add Server
              </motion.button>
            </div>
          </div>
        </div>
      </Panel>

      <Panel title="Workspaces" delay={0.1}>
        <div className="flex flex-wrap items-center gap-3 p-5">
          {registry.workspaces.map((w) => (
            <span key={w} className="flex items-center gap-2 rounded-xl border border-line bg-white/[0.02] px-3 py-2 font-mono text-xs text-ink-dim">
              {w}
              {w !== "Default" && (
                <button
                  onClick={() => remove("workspace", w)}
                  aria-label={`Remove workspace ${w}`}
                  className="cursor-pointer text-ink-faint transition-colors hover:text-neon-rose"
                >
                  <IconTrash width={12} height={12} />
                </button>
              )}
            </span>
          ))}
          <div className="flex items-center gap-2">
            <input
              value={wsName}
              onChange={(e) => setWsName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addWorkspace();
              }}
              placeholder="New workspace…"
              aria-label="New workspace name"
              className={`${inputCls} w-44`}
            />
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={addWorkspace}
              disabled={saving || !wsName.trim()}
              aria-label="Create workspace"
              className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg bg-gradient-to-br from-lime-600 to-neon-lime text-black disabled:cursor-not-allowed disabled:opacity-35"
            >
              <IconPlus width={15} height={15} />
            </motion.button>
          </div>
          <p className="w-full text-[11px] leading-5 text-ink-faint">
            Each workspace gets its own Goals and Journal under{" "}
            <span className="font-mono">Agentic OS/Workspaces/&lt;name&gt;/</span> in your vault. Deleting a workspace here
            never deletes its files.
          </p>
        </div>
      </Panel>
    </div>
  );
}
