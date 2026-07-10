"use client";

import { use } from "react";
import LLMSection from "@/components/LLMSection";
import AgentSection from "@/components/AgentSection";
import Panel from "@/components/ui/Panel";
import { useMission } from "@/components/store";

/** Dynamic page for user-added agents — API LLMs and command agents alike. */
export default function DynamicAgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { registry } = useMission();

  if (registry.llms.some((l) => l.id === id)) return <LLMSection llmId={id} />;
  if (registry.commandAgents.some((a) => a.id === id)) return <AgentSection agentId={id} />;

  return (
    <Panel title="Agent">
      <p className="p-6 font-mono text-xs text-ink-faint">Loading agent registry…</p>
    </Panel>
  );
}
