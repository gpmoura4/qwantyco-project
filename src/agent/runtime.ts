import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { MemorySaver } from "@langchain/langgraph";
import { createEscalationStore, type EscalationStore } from "./domain/escalations";
import { parseFaults, type Faults } from "./faults";
import { buildGraph, type AgentGraph } from "./graph";
import { createChatModel } from "./model";
import { DEFAULT_LIMITS, type Limits } from "./run";

// Everything one running app needs: the compiled graph (with its in-memory
// checkpointer), the escalation store and the limits.
export type AgentRuntime = {
  graph: AgentGraph;
  escalationStore: EscalationStore;
  limits: Limits;
};

export function createRuntime({
  model,
  faults = {},
  limits = DEFAULT_LIMITS,
}: {
  model: BaseChatModel;
  faults?: Faults;
  limits?: Limits;
}): AgentRuntime {
  const escalationStore = createEscalationStore();
  const graph = buildGraph({
    model,
    checkpointer: new MemorySaver(),
    escalationStore,
    faults,
    limits,
  });
  return { graph, escalationStore, limits };
}

// One runtime per server process, kept on globalThis so `next dev` hot reloads
// (which re-evaluate modules) do not wipe sessions and escalations (P7).
const globalForRuntime = globalThis as typeof globalThis & { __auroraRuntime?: AgentRuntime };

export function getRuntime(): AgentRuntime {
  globalForRuntime.__auroraRuntime ??= createRuntime({
    model: createChatModel(),
    faults: parseFaults(process.env.SIMULATE_TOOL_FAILURE),
  });
  return globalForRuntime.__auroraRuntime;
}

// Test seam: API route tests swap in a runtime with a fake model.
export function setRuntimeForTests(runtime: AgentRuntime | undefined): void {
  globalForRuntime.__auroraRuntime = runtime;
}
