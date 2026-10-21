import { randomUUID } from "node:crypto";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { sendDecision, sendMessage } from "@/agent/chat";
import type { Decision, Escalation, Proposal, ToolResult } from "@/agent/domain/schemas";
import { DEFAULT_LIMITS, type Limits } from "@/agent/run";
import { createRuntime, type AgentRuntime } from "@/agent/runtime";
import type { CaseInputs } from "./dataset";

// Evaluation target: runs one case through the same entry points as the UI
// (sendMessage / sendDecision) in a fresh runtime, so cases never share sessions
// or escalations. It returns a record of what really happened in each turn,
// taken from the graph state: the evaluator checks this, not the model's word.

export type TurnRecord = {
  message: string;
  // What the user would see: the reply, plus the decision result after an approval.
  answer: string;
  // Tool calls the model emitted in this turn.
  tool_calls: { id: string; name: string; args: Record<string, unknown> }[];
  // Results the executor (or the approval node) produced: only exist if it ran.
  tool_results: { tool_call_id: string; name: string; result: ToolResult<unknown> }[];
  // Proposal that paused the graph in this turn, and what the target decided (P9).
  proposal: Proposal | null;
  decision: Decision["decisao"] | null;
  // Controlled error returned by the core, if any.
  error: { code: string; message: string } | null;
};

export type CaseOutputs = {
  turns: TurnRecord[];
  // Escalations registered in this case's runtime at the end.
  escalations: Escalation[];
};

export async function runCase(
  model: BaseChatModel,
  inputs: CaseInputs,
  limits: Limits = DEFAULT_LIMITS,
): Promise<CaseOutputs> {
  const runtime = createRuntime({ model, limits });
  const sessionId = randomUUID();
  const turns: TurnRecord[] = [];

  for (const message of inputs.messages) {
    const before = (await stateMessages(runtime, sessionId)).length;
    const turn: TurnRecord = {
      message,
      answer: "",
      tool_calls: [],
      tool_results: [],
      proposal: null,
      decision: null,
      error: null,
    };

    const sent = await sendMessage(runtime, sessionId, message);
    if (!sent.ok) {
      turn.error = sent.error;
    } else {
      const replies = [sent.data.reply];
      if (sent.data.kind === "approval_required") {
        // The target plays the human, through the same backend validation as the UI.
        turn.proposal = sent.data.proposal;
        turn.decision = inputs.decisao ?? "rejeitar";
        const decided = await sendDecision(runtime, {
          sessionId,
          proposta_id: sent.data.proposal.id,
          decisao: turn.decision,
        });
        if (decided.ok) replies.push(decided.data.reply);
        else turn.error = decided.error;
      }
      turn.answer = replies.filter(Boolean).join("\n");
    }

    recordTools(turn, (await stateMessages(runtime, sessionId)).slice(before));
    turns.push(turn);
  }

  return { turns, escalations: runtime.escalationStore.list() };
}

async function stateMessages(runtime: AgentRuntime, sessionId: string): Promise<BaseMessage[]> {
  const snapshot = await runtime.graph.getState({ configurable: { thread_id: sessionId } });
  return snapshot.values.messages ?? [];
}

function recordTools(turn: TurnRecord, messages: BaseMessage[]): void {
  for (const message of messages) {
    if (AIMessage.isInstance(message)) {
      for (const call of message.tool_calls ?? []) {
        turn.tool_calls.push({ id: call.id ?? "", name: call.name, args: call.args });
      }
    } else if (ToolMessage.isInstance(message)) {
      turn.tool_results.push({
        tool_call_id: message.tool_call_id,
        name: message.name ?? "",
        result: JSON.parse(String(message.content)),
      });
    }
  }
}
