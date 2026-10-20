import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, SystemMessage, type ToolMessage } from "@langchain/core/messages";
import {
  END,
  interrupt,
  isNodeTimeoutError,
  MessagesValue,
  START,
  StateGraph,
  StateSchema,
  type BaseCheckpointSaver,
  type GraphNode,
} from "@langchain/langgraph";
import { z } from "zod";
import { confirmationText } from "./approval";
import { registerEscalation, type EscalationStore } from "./domain/escalations";
import {
  DecisionSchema,
  fail,
  ProposalSchema,
  type Decision,
  type Escalation,
  type Proposal,
  type ToolResult,
} from "./domain/schemas";
import { executeToolCall, toToolMessage, type ExecutorContext } from "./executor";
import { TransientToolError, type Faults } from "./faults";
import { SYSTEM_PROMPT } from "./prompt";
import { DEFAULT_LIMITS, type Limits } from "./run";
import { TOOLS } from "./tools";

// Typed graph state. pendingProposal holds the escalation waiting for a human
// decision, plus the id of the tool call it answers.
export const AgentState = new StateSchema({
  messages: MessagesValue,
  pendingProposal: z
    .object({ proposal: ProposalSchema, toolCallId: z.string() })
    .nullable()
    .default(null),
});

export type AgentStateValue = typeof AgentState.State;

type BuildGraphOptions = {
  // Injected so tests use a fake model through the same graph and executor.
  model: BaseChatModel;
  // Persists state per thread_id (one thread per chat session).
  checkpointer: BaseCheckpointSaver;
  // Where approved escalations are registered.
  escalationStore: EscalationStore;
  // Simulated tool failures (off by default).
  faults?: Faults;
  // Timeouts and retries of the nodes (the per-invocation budget is in runAgent).
  limits?: Limits;
};

export function buildGraph({
  model,
  checkpointer,
  escalationStore,
  faults = {},
  limits = DEFAULT_LIMITS,
}: BuildGraphOptions) {
  if (!model.bindTools) throw new Error("The chat model does not support tool calling.");

  const allowlist = new Map(TOOLS.map((entry) => [entry.tool.name, entry]));
  const modelWithTools = model.bindTools(TOOLS.map((entry) => entry.tool));
  const attempts = new Map<string, number>();

  // Model node: the LLM decides whether to answer or to call tools.
  const callModel: GraphNode<typeof AgentState> = async (state, config) => {
    const response = await modelWithTools.invoke(
      [new SystemMessage(SYSTEM_PROMPT), ...state.messages],
      { signal: config.signal },
    );
    return { messages: [response] };
  };

  // Executor node: validates every tool call of the last AI message. Reads run
  // now; an escalation becomes a pending proposal (one at a time). Malformed
  // calls from the model are answered with INVALID_ARGS instead of ignored.
  const executeTools: GraphNode<typeof AgentState> = async (state, config) => {
    const last = state.messages.at(-1);
    const ai = last && AIMessage.isInstance(last) ? last : undefined;
    const ctx: ExecutorContext = {
      allowlist,
      store: escalationStore,
      faults,
      attempts,
      signal: config.signal,
    };
    const messages: ToolMessage[] = [];
    let pendingProposal: { proposal: Proposal; toolCallId: string } | null = null;

    for (const bad of ai?.invalid_tool_calls ?? []) {
      messages.push(
        toToolMessage(
          bad.id ?? "",
          bad.name ?? "unknown",
          fail("INVALID_ARGS", `Chamada de ferramenta malformada: ${bad.error ?? "JSON inválido"}.`),
        ),
      );
    }

    for (const call of ai?.tool_calls ?? []) {
      const outcome = await executeToolCall(call, ctx);
      if (outcome.kind === "result") {
        messages.push(outcome.message);
      } else if (pendingProposal) {
        messages.push(
          toToolMessage(
            call.id ?? "",
            call.name,
            fail("PROPOSAL_ALREADY_PENDING", "Já existe uma proposta aguardando decisão."),
          ),
        );
      } else {
        pendingProposal = { proposal: outcome.proposal, toolCallId: call.id ?? "" };
      }
    }
    return { messages, pendingProposal };
  };

  // Approval node: pauses the graph until a human decides. Nothing with side
  // effects runs before interrupt(), because the node re-runs from the start on resume.
  const humanApproval: GraphNode<typeof AgentState> = async (state) => {
    const pending = state.pendingProposal;
    if (!pending) return {};

    // The resume value is validated by Zod (DecisionSchema) before it gets here.
    const decision: Decision = interrupt(pending.proposal, { responseSchema: DecisionSchema });

    let result: ToolResult<Escalation>;
    if (decision.proposta_id !== pending.proposal.id) {
      result = fail("PROPOSAL_MISMATCH", "A decisão não corresponde à proposta pendente.");
    } else if (decision.decisao === "rejeitar") {
      result = fail("ESCALATION_REJECTED", "Escalonamento rejeitado. Nada foi registrado.");
    } else {
      // Guards run again here: the ticket may have been escalated meanwhile.
      result = registerEscalation(escalationStore, pending.proposal);
    }

    // The final message comes from the real result, never from the model (D28).
    return {
      messages: [
        toToolMessage(pending.toolCallId, "register_escalation", result),
        new AIMessage(confirmationText(result)),
      ],
      pendingProposal: null,
    };
  };

  const routeAfterModel = (state: typeof AgentState.State) => {
    const last = state.messages.at(-1);
    const wantsTools =
      last &&
      AIMessage.isInstance(last) &&
      (last.tool_calls?.length || last.invalid_tool_calls?.length);
    return wantsTools ? "executeTools" : END;
  };

  const routeAfterTools = (state: typeof AgentState.State) =>
    state.pendingProposal ? "humanApproval" : "callModel";

  // Retries only technical failures; business errors are data and never retried.
  const retryPolicy = (maxAttempts: number, retryOn: (error: unknown) => boolean) => ({
    maxAttempts,
    initialInterval: limits.retryIntervalMs,
    retryOn,
  });
  const isTransient = (error: unknown) =>
    error instanceof TransientToolError || isNodeTimeoutError(error);
  const isNotAbort = (error: unknown) => (error as Error | null)?.name !== "AbortError";

  // callModel -> (executeTools -> callModel)* -> END
  //                executeTools -> humanApproval -> END   (when there is a proposal)
  return new StateGraph(AgentState)
    .addNode("callModel", callModel, {
      retryPolicy: retryPolicy(limits.modelMaxAttempts, isNotAbort),
      timeout: limits.modelTimeoutMs,
    })
    .addNode("executeTools", executeTools, {
      retryPolicy: retryPolicy(limits.toolMaxAttempts, isTransient),
      timeout: limits.toolTimeoutMs,
    })
    .addNode("humanApproval", humanApproval)
    .addEdge(START, "callModel")
    .addConditionalEdges("callModel", routeAfterModel, ["executeTools", END])
    .addConditionalEdges("executeTools", routeAfterTools, ["humanApproval", "callModel"])
    .addEdge("humanApproval", END)
    .compile({ checkpointer });
}

export type AgentGraph = ReturnType<typeof buildGraph>;
