import { isLocalEndpoint } from "./registry";

/**
 * How is each agent paid for?
 *
 * This exists because the usage ledger's `costUsd` is NOT uniformly "money you
 * were charged". The Claude CLI reports a cost figure even when it's
 * authenticated against a Claude subscription (OAuth `/login`), where it's an
 * *equivalent-cost estimate* — what those tokens would have cost at API list
 * prices — not an invoice line. Presenting that as "spend" is misleading, so
 * every cost surface splits by mode instead.
 */
export type BillingMode = "subscription" | "api" | "local" | "unknown";

export const BILLING_LABEL: Record<BillingMode, string> = {
  subscription: "subscription",
  api: "API key",
  local: "local · free",
  unknown: "self-authenticated",
};

export const BILLING_NOTE: Record<BillingMode, string> = {
  subscription: "Runs against a subscription — costs shown are estimates at API list prices, not charges. The real limit is your plan's usage allowance.",
  api: "Billed per token against an API key. These are real charges.",
  local: "Runs on this machine. No cost.",
  unknown: "This agent's CLI authenticates itself (its own login or key), so Mission Control can't see how it bills.",
};

export interface LlmLite {
  id: string;
  baseUrl: string;
}

/**
 * Server-side: resolve an agent's billing mode.
 * - claude → subscription unless an ANTHROPIC_API_KEY is configured
 * - registry LLM → local for localhost endpoints, otherwise API-billed
 * - command agents (Codex, Hermes, OpenClaw, custom CLIs) → unknown: they use
 *   their own login, which may be a subscription (Codex/ChatGPT, Hermes/Nous)
 *   or an API key (OpenClaw → Gemini). We don't guess, and they don't report
 *   costs into the ledger anyway.
 */
export function billingFor(agentId: string, llms: LlmLite[] = []): BillingMode {
  if (agentId === "claude") return process.env.ANTHROPIC_API_KEY ? "api" : "subscription";
  if (agentId === "auto") return "unknown"; // routes to whoever — per-run reality varies
  const llm = llms.find((l) => l.id === agentId);
  if (llm) return isLocalEndpoint(llm.baseUrl) ? "local" : "api";
  return "unknown";
}

/** True only when a cost figure represents money actually charged. */
export function isBilled(mode: BillingMode): boolean {
  return mode === "api";
}
