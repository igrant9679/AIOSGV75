"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Accent } from "@/lib/accents";
import type { AgentInfo, ConsoleEntry, RegistryInfo, RunStats, SystemStats } from "@/lib/types";
import { renderChatMarkdown } from "@/lib/chatMarkdown";
import { REMEMBER_RE, GOAL_RE, JOURNAL_RE, MISSION_RE } from "@/lib/memoryPrompt";

export interface FeedEvent {
  id: string;
  ts: number;
  source: string;
  text: string;
  accent: Accent;
}

/** An agent-requested action awaiting human sign-off (the autonomy slider's gate). */
export interface PendingApproval {
  id: string;
  kind: "mission";
  payload: string;
  source: string;
  ts: number;
}

/** Abort controllers for in-flight runs, keyed by chat id. Module-scoped so
 * they survive page navigation (the components unmount, the runs continue). */
export const runControllers = new Map<string, AbortController>();

interface MissionStore {
  events: FeedEvent[];
  addEvent: (source: string, text: string, accent?: Accent) => void;
  system: SystemStats | null;
  cpuHistory: number[];
  memHistory: number[];
  claudeStats: RunStats;
  bumpClaudeStats: (delta: Partial<RunStats>) => void;
  agents: AgentInfo[];
  chats: Record<string, ConsoleEntry[]>;
  appendChat: (chatId: string, entry: Omit<ConsoleEntry, "id" | "ts">) => string;
  appendText: (chatId: string, entryId: string, text: string) => void;
  clearChat: (chatId: string) => void;
  sessions: Record<string, string | null>;
  setSession: (chatId: string, sid: string | null) => void;
  busy: Record<string, boolean>;
  setBusy: (chatId: string, b: boolean) => void;
  vaultOk: boolean | null;
  summaries: Record<string, { text: string; covered: number }>;
  setSummary: (chatId: string, text: string, covered: number) => void;
  registry: RegistryInfo;
  refreshRegistry: () => Promise<void>;
  memory: string;
  refreshMemory: () => Promise<void>;
  workspace: string;
  setWorkspace: (w: string) => void;
  pendingApprovals: PendingApproval[];
  resolveApproval: (id: string, approve: boolean) => void;
}

const Ctx = createContext<MissionStore | null>(null);

let eventSeq = 0;
let entrySeq = 0;

export function MissionProvider({ children }: { children: ReactNode }) {
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [system, setSystem] = useState<SystemStats | null>(null);
  const [cpuHistory, setCpuHistory] = useState<number[]>([]);
  const [memHistory, setMemHistory] = useState<number[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [chats, setChats] = useState<Record<string, ConsoleEntry[]>>({});
  const [sessions, setSessions] = useState<Record<string, string | null>>({});
  const [busy, setBusyState] = useState<Record<string, boolean>>({});
  const [claudeStats, setClaudeStats] = useState<RunStats>({
    totalCostUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    turns: 0,
    durationMs: 0,
    runs: 0,
  });

  const addEvent = useCallback((source: string, text: string, accent: Accent = "cyan") => {
    setEvents((prev) =>
      [{ id: `e${eventSeq++}`, ts: Date.now(), source, text, accent }, ...prev].slice(0, 60),
    );
  }, []);

  const bumpClaudeStats = useCallback((delta: Partial<RunStats>) => {
    setClaudeStats((prev) => ({
      totalCostUsd: prev.totalCostUsd + (delta.totalCostUsd ?? 0),
      inputTokens: prev.inputTokens + (delta.inputTokens ?? 0),
      outputTokens: prev.outputTokens + (delta.outputTokens ?? 0),
      turns: prev.turns + (delta.turns ?? 0),
      durationMs: prev.durationMs + (delta.durationMs ?? 0),
      runs: prev.runs + (delta.runs ?? 0),
    }));
  }, []);

  const appendChat = useCallback((chatId: string, entry: Omit<ConsoleEntry, "id" | "ts">) => {
    const id = `m${entrySeq++}`;
    setChats((prev) => ({
      ...prev,
      [chatId]: [...(prev[chatId] ?? []), { ...entry, id, ts: Date.now() }],
    }));
    return id;
  }, []);

  const appendText = useCallback((chatId: string, entryId: string, text: string) => {
    setChats((prev) => ({
      ...prev,
      [chatId]: (prev[chatId] ?? []).map((e) => (e.id === entryId ? { ...e, text: e.text + text } : e)),
    }));
  }, []);

  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  const resolveApproval = useCallback(
    (id: string, approve: boolean) => {
      setPendingApprovals((prev) => {
        const approval = prev.find((a) => a.id === id);
        if (approval) {
          if (approve) {
            fetch("/api/missions", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                title: `🤖 via ${approval.source}: ${approval.payload.slice(0, 40)}`,
                prompt: approval.payload,
                strategy: "single",
                agentIds: ["claude"],
              }),
            })
              .then((r) => {
                if (r.ok) addEvent("MISSIONS", `Approved — ${approval.source}'s mission launched`, "cyan");
                else addEvent("MISSIONS", "Approved mission failed to launch", "rose");
              })
              .catch(() => addEvent("MISSIONS", "Approved mission failed to launch", "rose"));
          } else {
            addEvent("MISSIONS", `Rejected ${approval.source}'s mission request`, "amber");
          }
        }
        return prev.filter((a) => a.id !== id);
      });
    },
    [addEvent],
  );

  const [summaries, setSummaries] = useState<Record<string, { text: string; covered: number }>>({});
  const setSummary = useCallback((chatId: string, text: string, covered: number) => {
    setSummaries((prev) => ({ ...prev, [chatId]: { text, covered } }));
  }, []);

  const clearChat = useCallback((chatId: string) => {
    setChats((prev) => ({ ...prev, [chatId]: [] }));
    setSessions((prev) => ({ ...prev, [chatId]: null }));
    setSummaries((prev) => {
      const next = { ...prev };
      delete next[chatId];
      return next;
    });
  }, []);

  const setSession = useCallback((chatId: string, sid: string | null) => {
    setSessions((prev) => ({ ...prev, [chatId]: sid }));
  }, []);

  const setBusy = useCallback((chatId: string, b: boolean) => {
    setBusyState((prev) => ({ ...prev, [chatId]: b }));
  }, []);

  // poll system vitals
  const greeted = useRef(false);
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch("/api/system");
        if (!res.ok || !alive) return;
        const stats = (await res.json()) as SystemStats;
        setSystem(stats);
        setCpuHistory((h) => [...h, stats.cpu].slice(-40));
        setMemHistory((h) => [...h, (stats.memUsed / stats.memTotal) * 100].slice(-40));
        if (!greeted.current) {
          greeted.current = true;
          addEvent("SYSTEM", `Telemetry link established with ${stats.hostname}`, "lime");
          if (stats.claudeVersion) addEvent("CLAUDE", `CLI bridge online — v${stats.claudeVersion}`, "cyan");
        }
      } catch {
        /* server not ready yet */
      }
    };
    tick();
    const iv = setInterval(tick, 3000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [addEvent]);

  // registry (custom LLMs, command agents, workspaces)
  const [registry, setRegistry] = useState<RegistryInfo>({ llms: [], commandAgents: [], workspaces: ["Default"] });
  const refreshRegistry = useCallback(async () => {
    try {
      const res = await fetch("/api/registry");
      if (res.ok) setRegistry((await res.json()) as RegistryInfo);
    } catch {
      /* server not ready */
    }
  }, []);
  useEffect(() => {
    refreshRegistry();
  }, [refreshRegistry]);

  // shared memory (Agentic OS/Memory.md)
  const [memory, setMemory] = useState("");
  const refreshMemory = useCallback(async () => {
    try {
      const res = await fetch("/api/memory");
      if (res.ok) setMemory(((await res.json()) as { content: string }).content ?? "");
    } catch {
      /* vault offline */
    }
  }, []);
  useEffect(() => {
    refreshMemory();
  }, [refreshMemory]);

  // active workspace (persisted)
  const [workspace, setWorkspaceState] = useState("Default");
  useEffect(() => {
    const stored = window.localStorage.getItem("mc-workspace");
    if (stored) setWorkspaceState(stored);
  }, []);
  const setWorkspace = useCallback((w: string) => {
    setWorkspaceState(w);
    window.localStorage.setItem("mc-workspace", w);
  }, []);

  // vault status probe
  const [vaultOk, setVaultOk] = useState<boolean | null>(null);
  useEffect(() => {
    fetch("/api/vault/status")
      .then((r) => r.json())
      .then((s: { ok: boolean; base: string }) => {
        setVaultOk(s.ok);
        addEvent("VAULT", s.ok ? `Obsidian vault linked — ${s.base}` : "Obsidian vault not reachable", s.ok ? "lime" : "rose");
      })
      .catch(() => setVaultOk(false));
  }, [addEvent]);

  // After each run settles: harvest <remember> tags into shared memory, strip
  // them from the chat, and auto-save the exchange to the vault (one md/day).
  const persistedIds = useRef(new Set<string>());
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (vaultOk === false) return;
    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(() => {
      for (const [chatId, entries] of Object.entries(chats)) {
        if (busy[chatId]) continue; // wait until the run settles
        const fresh = entries.filter((e) => !persistedIds.current.has(e.id) && e.text.trim());
        if (fresh.length === 0) continue;
        for (const e of fresh) persistedIds.current.add(e.id);

        // harvest OS-verb tags from assistant replies
        const runVerb = {
          remember: (payload: string) => {
            fetch("/api/memory", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ entry: payload, source: chatId }),
            })
              .then((r) => {
                if (r.ok) {
                  addEvent("MEMORY", `${chatId} remembered: ${payload.slice(0, 70)}`, "violet");
                  refreshMemory();
                }
              })
              .catch(() => {});
          },
          goal: async (payload: string) => {
            try {
              const res = await fetch(`/api/vault/goals?workspace=${encodeURIComponent(workspace)}`);
              const tasks = res.ok ? (((await res.json()) as { tasks: { text: string; done: boolean }[] }).tasks ?? []) : [];
              await fetch("/api/vault/goals", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ tasks: [...tasks, { text: payload, done: false }], workspace }),
              });
              addEvent("GOALS", `${chatId} added a goal: ${payload.slice(0, 70)}`, "lime");
            } catch {
              addEvent("GOALS", "agent goal failed to save", "rose");
            }
          },
          journal: (payload: string) => {
            fetch("/api/vault/journal", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ entry: payload, source: chatId, workspace }),
            })
              .then((r) => {
                if (r.ok) addEvent("JOURNAL", `${chatId} wrote a journal entry`, "rose");
              })
              .catch(() => {});
          },
          mission: (payload: string) => {
            // missions spend money and act autonomously — gate behind human approval
            setPendingApprovals((prev) => [
              ...prev,
              { id: `ap${eventSeq++}`, kind: "mission", payload, source: chatId, ts: Date.now() },
            ]);
            addEvent("APPROVAL", `${chatId} requests a mission — approve or reject above`, "amber");
          },
        };
        const VERB_TAGS: { re: RegExp; run: (payload: string) => void }[] = [
          { re: REMEMBER_RE, run: runVerb.remember },
          { re: GOAL_RE, run: runVerb.goal },
          { re: JOURNAL_RE, run: runVerb.journal },
          { re: MISSION_RE, run: runVerb.mission },
        ];

        let anyVerb = false;
        const cleaned = fresh.map((e) => {
          if (e.role !== "assistant" || !e.text.includes("<")) return e;
          let text = e.text;
          for (const verb of VERB_TAGS) {
            for (const m of [...text.matchAll(verb.re)]) {
              const payload = m[1].trim();
              if (payload) {
                anyVerb = true;
                verb.run(payload);
              }
            }
            text = text.replace(verb.re, "");
          }
          return text === e.text ? e : { ...e, text: text.replace(/\n{3,}/g, "\n\n").trim() };
        });
        if (anyVerb) {
          setChats((prev) => ({
            ...prev,
            [chatId]: (prev[chatId] ?? []).map((e) => {
              const c = cleaned.find((x) => x.id === e.id);
              return c && c.text !== e.text ? { ...e, text: c.text } : e;
            }),
          }));
        }

        fetch("/api/vault/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agent: chatId, markdown: renderChatMarkdown(chatId, cleaned) }),
        })
          .then((r) => {
            if (r.ok) addEvent("VAULT", `Chat saved to Agentic OS/Chats`, "lime");
            else addEvent("VAULT", "Chat save failed", "rose");
          })
          .catch(() => addEvent("VAULT", "Chat save failed", "rose"));
      }
    }, 1200);
  }, [chats, busy, vaultOk, addEvent, refreshMemory, workspace]);

  // probe companion agents — re-poll so slow cold-boot CLIs recover without a refresh
  const agentAvailability = useRef(new Map<string, boolean>());
  useEffect(() => {
    let alive = true;
    const probeAgents = async () => {
      try {
        const res = await fetch("/api/agents");
        if (!res.ok || !alive) return;
        const list = (await res.json()) as AgentInfo[];
        setAgents(list);
        for (const a of list) {
          const prev = agentAvailability.current.get(a.id);
          if (prev === a.available) continue; // only log changes
          agentAvailability.current.set(a.id, a.available);
          addEvent(
            a.name.toUpperCase(),
            a.available
              ? `${a.name} responder ${prev === false ? "back online" : "detected"} (${a.version ?? "unknown"})`
              : `${a.name} offline — '${a.binary}' not responding (will re-probe)`,
            a.available ? a.accent : "rose",
          );
        }
      } catch {
        /* server not ready yet */
      }
    };
    probeAgents();
    const iv = setInterval(probeAgents, 45_000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [addEvent]);

  const value = useMemo(
    () => ({
      events,
      addEvent,
      system,
      cpuHistory,
      memHistory,
      claudeStats,
      bumpClaudeStats,
      agents,
      chats,
      appendChat,
      appendText,
      clearChat,
      sessions,
      setSession,
      busy,
      setBusy,
      vaultOk,
      summaries,
      setSummary,
      registry,
      refreshRegistry,
      memory,
      refreshMemory,
      workspace,
      setWorkspace,
      pendingApprovals,
      resolveApproval,
    }),
    [
      events,
      addEvent,
      system,
      cpuHistory,
      memHistory,
      claudeStats,
      bumpClaudeStats,
      agents,
      chats,
      appendChat,
      appendText,
      clearChat,
      sessions,
      setSession,
      busy,
      setBusy,
      vaultOk,
      summaries,
      setSummary,
      registry,
      refreshRegistry,
      memory,
      refreshMemory,
      workspace,
      setWorkspace,
      pendingApprovals,
      resolveApproval,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMission(): MissionStore {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useMission must be used inside MissionProvider");
  return ctx;
}
