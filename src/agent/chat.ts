import { AIMessage, HumanMessage, type BaseMessage } from "@langchain/core/messages";
import { z } from "zod";
import { decideProposal, getPendingProposal } from "./approval";
import { DecisionSchema, fail, ok, type Proposal, type ToolResult } from "./domain/schemas";
import { runAgent } from "./run";
import type { AgentRuntime } from "./runtime";

// Contracts of the chat API (validated by the Next.js routes before calling here).
// The session id is a client-generated UUID and becomes the graph thread_id (R2).
export const MessageRequestSchema = z.object({
  sessionId: z.uuid(),
  message: z.string().trim().min(1).max(2_000),
});

export const DecisionRequestSchema = DecisionSchema.extend({
  sessionId: z.uuid(),
});

export type ChatReply =
  | { kind: "reply"; reply: string }
  | { kind: "approval_required"; proposal: Proposal; reply: string };

// Handles one user message in a session. While a proposal waits for a decision,
// new messages are refused (R4), so nothing is left hanging in the checkpoint.
export async function sendMessage(
  runtime: AgentRuntime,
  sessionId: string,
  message: string,
): Promise<ToolResult<ChatReply>> {
  const { graph, limits } = runtime;

  if (await getPendingProposal(graph, sessionId)) {
    return fail(
      "PROPOSAL_PENDING",
      "Há uma proposta de escalonamento aguardando decisão. Aprove ou rejeite antes de enviar outra mensagem.",
    );
  }

  const run = await runAgent(graph, { messages: [new HumanMessage(message)] }, sessionId, limits);
  if (!run.ok) return run;

  const reply = lastAssistantText(run.data.messages);
  const proposal = await getPendingProposal(graph, sessionId);
  return ok(proposal ? { kind: "approval_required", proposal, reply } : { kind: "reply", reply });
}

// Handles the human decision on the pending proposal of a session.
export async function sendDecision(
  runtime: AgentRuntime,
  request: z.infer<typeof DecisionRequestSchema>,
): Promise<ToolResult<ChatReply>> {
  const { sessionId, ...decision } = request;
  const result = await decideProposal({ ...runtime, threadId: sessionId, decision });
  if (!result.ok) return result;
  return ok({ kind: "reply", reply: result.data.reply });
}

function lastAssistantText(messages: BaseMessage[]): string {
  const last = [...messages].reverse().find(AIMessage.isInstance);
  return typeof last?.content === "string" ? last.content : "";
}
