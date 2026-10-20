import { Command } from "@langchain/langgraph";
import type { EscalationStore } from "./domain/escalations";
import {
  fail,
  ok,
  ProposalSchema,
  type Decision,
  type Escalation,
  type Proposal,
  type ToolResult,
} from "./domain/schemas";
import type { AgentGraph } from "./graph";
import { DEFAULT_LIMITS, runAgent, type Limits } from "./run";

const sessionConfig = (threadId: string) => ({ configurable: { thread_id: threadId } });

// Deterministic confirmation built from the real result (A3): the model never
// writes the confirmation of a write operation.
export function confirmationText(result: ToolResult<Escalation>): string {
  if (result.ok) {
    return `Escalonamento ${result.data.id} registrado para o chamado ${result.data.chamado_id}.`;
  }
  if (result.error.code === "ESCALATION_REJECTED") return result.error.message;
  return `Não foi possível registrar o escalonamento: ${result.error.message}`;
}

// The proposal waiting for a human decision in this session, if any.
export async function getPendingProposal(
  graph: AgentGraph,
  threadId: string,
): Promise<Proposal | null> {
  const snapshot = await graph.getState(sessionConfig(threadId));
  const value = snapshot.tasks.flatMap((task) => task.interrupts)[0]?.value;
  const parsed = ProposalSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

// Backend validation of a human decision (D27). The graph is only resumed when the
// decision matches the proposal pending in this session. The resume is a new
// invocation with its own budget: the human waiting time is not counted.
export async function decideProposal({
  graph,
  escalationStore,
  threadId,
  decision,
  limits = DEFAULT_LIMITS,
}: {
  graph: AgentGraph;
  escalationStore: EscalationStore;
  threadId: string;
  decision: Decision;
  limits?: Limits;
}): Promise<ToolResult<{ reply: string }>> {
  const pending = await getPendingProposal(graph, threadId);

  if (!pending) {
    // Repeated approval of a proposal that was already registered: answer with the
    // existing record instead of registering again (idempotent).
    const existing = escalationStore.findByProposalId(decision.proposta_id);
    if (existing) {
      return ok({ reply: `Escalonamento ${existing.id} já registrado para o chamado ${existing.chamado_id}.` });
    }
    return fail("NO_PENDING_PROPOSAL", "Não há proposta aguardando decisão nesta sessão.");
  }

  if (pending.id !== decision.proposta_id) {
    return fail("PROPOSAL_MISMATCH", "A decisão não corresponde à proposta pendente.");
  }

  const run = await runAgent(graph, new Command({ resume: decision }), threadId, limits);
  if (!run.ok) return run;
  return ok({ reply: String(run.data.messages.at(-1)?.content ?? "") });
}
