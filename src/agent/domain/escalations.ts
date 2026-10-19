import { fail, ok, type Escalation, type RegisterEscalationInput, type ToolResult } from "./schemas";
import { getTicket } from "./tickets";

// In-memory record of escalations (simulated, as the PDF allows). Injected into
// the functions so each test gets its own isolated store (S6).
export type EscalationStore = {
  add(input: RegisterEscalationInput): Escalation;
  findByTicketId(ticketId: string): Escalation | undefined;
  list(): Escalation[];
};

export function createEscalationStore(): EscalationStore {
  const records: Escalation[] = [];
  return {
    add(input) {
      const record: Escalation = {
        id: `ESC-${String(records.length + 1).padStart(3, "0")}`,
        ticket_id: input.ticket_id,
        summary: input.summary,
        justification: input.justification,
      };
      records.push(record);
      return { ...record };
    },
    findByTicketId(ticketId) {
      const record = records.find((r) => r.ticket_id === ticketId);
      return record && { ...record };
    },
    list() {
      return records.map((r) => ({ ...r }));
    },
  };
}

// Business guards live here, not in the prompt: whoever calls this function
// (model, API route, test) cannot escalate a non-open or already escalated ticket.
export function registerEscalation(
  store: EscalationStore,
  input: RegisterEscalationInput,
): ToolResult<Escalation> {
  const found = getTicket({ ticket_id: input.ticket_id });
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

  return ok(store.add(input));
}
