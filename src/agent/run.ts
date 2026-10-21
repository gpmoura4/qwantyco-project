import { Command, GraphRecursionError } from "@langchain/langgraph";
import { DecisionSchema, fail, ok, type ToolResult } from "./domain/schemas";
import type { AgentGraph, AgentStateValue } from "./graph";

// A new user message ({ messages }) or a resume after approval (Command).
type RunInput = Parameters<AgentGraph["invoke"]>[0];

// Execution limits (L1, L2). Defaults sized for a local model (5–17 s per call).
export type Limits = {
  toolTimeoutMs: number; // per attempt of the executeTools node
  toolMaxAttempts: number; // total attempts (1 = no retry)
  modelTimeoutMs: number; // per attempt of the callModel node
  modelMaxAttempts: number;
  retryIntervalMs: number; // first backoff interval (doubles each retry)
  maxSteps: number; // graph steps per invocation (recursionLimit)
  maxActiveMs: number; // wall-clock budget per invocation
};

export const DEFAULT_LIMITS: Limits = {
  toolTimeoutMs: 5_000,
  toolMaxAttempts: 3,
  modelTimeoutMs: 60_000,
  modelMaxAttempts: 2,
  retryIntervalMs: 500,
  maxSteps: 12,
  maxActiveMs: 120_000,
};

// Single entry point to run the graph with limits. Each invocation gets its own
// budget, and a pause for human approval ends the invocation, so the human
// waiting time is never counted (L2). Failures become a controlled error.
export async function runAgent(
  graph: AgentGraph,
  input: RunInput,
  threadId: string,
  limits: Limits = DEFAULT_LIMITS,
): Promise<ToolResult<AgentStateValue>> {
  try {
    const state = await graph.invoke(input, {
      ...traceConfig(input),
      configurable: { thread_id: threadId },
      recursionLimit: limits.maxSteps,
      signal: AbortSignal.timeout(limits.maxActiveMs),
    });
    return ok(state);
  } catch (error) {
    if (error instanceof GraphRecursionError) {
      return fail(
        "EXECUTION_LIMIT",
        "A solicitação atingiu o limite de passos de execução e foi interrompida. Nenhuma operação foi registrada.",
      );
    }
    if (isAbort(error)) {
      return fail(
        "EXECUTION_LIMIT",
        "A solicitação atingiu o tempo limite de execução e foi interrompida. Nenhuma operação foi registrada.",
      );
    }
    return fail(
      "EXECUTION_FAILED",
      "Não foi possível concluir a solicitação por uma falha técnica, mesmo após novas tentativas. Nenhuma operação foi registrada.",
    );
  }
}

// How the invocation shows up in LangSmith (D43): a new user message or the resume
// after a human decision. LangGraph already copies thread_id into the trace
// metadata, so both kinds of a session are grouped in the same LangSmith thread.
function traceConfig(input: RunInput) {
  if (input instanceof Command) {
    const decision = DecisionSchema.safeParse(input.resume);
    return {
      runName: "aurora_resume",
      tags: ["aurora", "resume"],
      metadata: { run_kind: "resume", proposta_id: decision.data?.proposta_id },
    };
  }
  return {
    runName: "aurora_message",
    tags: ["aurora", "message"],
    metadata: { run_kind: "message" },
  };
}

function isAbort(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name;
  return name === "AbortError" || name === "TimeoutError";
}
