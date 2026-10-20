import {
  fail,
  ok,
  type Escalation,
  type GetTicketInput,
  type ListTicketsInput,
  type Proposal,
  type Ticket,
  type TicketView,
  type ToolResult,
} from "./schemas";
import { getTicket, listTickets } from "./tickets";

// In-memory record of escalations (simulated, as the PDF allows). Injected into
// the functions so each test gets its own isolated store (D18).
export type EscalationStore = {
  add(proposal: Proposal): Escalation;
  findByTicketId(ticketId: string): Escalation | undefined;
  findByProposalId(proposalId: string): Escalation | undefined;
  list(): Escalation[];
};

export function createEscalationStore(): EscalationStore {
  const records: Escalation[] = [];
  return {
    add(proposal) {
      const record: Escalation = {
        id: `ESC-${String(records.length + 1).padStart(3, "0")}`,
        proposta_id: proposal.id,
        chamado_id: proposal.chamado_id,
        resumo: proposal.resumo,
        justificativa: proposal.justificativa,
      };
      records.push(record);
      return { ...record };
    },
    findByTicketId(ticketId) {
      const record = records.find((r) => r.chamado_id === ticketId);
      return record && { ...record };
    },
    findByProposalId(proposalId) {
      const record = records.find((r) => r.proposta_id === proposalId);
      return record && { ...record };
    },
    list() {
      return records.map((r) => ({ ...r }));
    },
  };
}

// Business guards live here, not in the prompt. Used twice: before a proposal
// is shown to the human, and again at registration time (state may have changed).
export function checkEscalationAllowed(
  store: EscalationStore,
  chamadoId: string,
): ToolResult<Ticket> {
  const found = getTicket({ chamado_id: chamadoId });
  if (!found.ok) return found;

  const ticket = found.data;
  if (ticket.situacao !== "aberto") {
    return fail(
      "TICKET_NOT_OPEN",
      `Chamado ${ticket.id} não pode ser escalonado: a situação atual é "${ticket.situacao}". Somente chamados abertos podem ser escalonados.`,
    );
  }

  const existing = store.findByTicketId(ticket.id);
  if (existing) {
    return fail("ALREADY_ESCALATED", `Chamado ${ticket.id} já foi escalonado (${existing.id}).`);
  }

  return ok(ticket);
}

// Registers an approved proposal. Idempotent per proposal (D11, layer 1):
// the same proposal arriving twice returns the existing record instead of a new one.
export function registerEscalation(
  store: EscalationStore,
  proposal: Proposal,
): ToolResult<Escalation> {
  const replay = store.findByProposalId(proposal.id);
  if (replay) return ok(replay);

  const allowed = checkEscalationAllowed(store, proposal.chamado_id);
  if (!allowed.ok) return allowed;

  return ok(store.add(proposal));
}

// --- Read views: ticket + its escalation (the ticket itself is never changed) ---

function withEscalation(store: EscalationStore, ticket: Ticket): TicketView {
  const escalation = store.findByTicketId(ticket.id);
  return {
    ...ticket,
    escalonamento: escalation
      ? { id: escalation.id, resumo: escalation.resumo, justificativa: escalation.justificativa }
      : null,
  };
}

export function getTicketView(
  store: EscalationStore,
  input: GetTicketInput,
): ToolResult<TicketView> {
  const found = getTicket(input);
  return found.ok ? ok(withEscalation(store, found.data)) : found;
}

export function listTicketViews(
  store: EscalationStore,
  input: ListTicketsInput,
): ToolResult<TicketView[]> {
  const listed = listTickets(input);
  return listed.ok ? ok(listed.data.map((ticket) => withEscalation(store, ticket))) : listed;
}
