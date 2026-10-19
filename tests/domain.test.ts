import { describe, expect, it } from "vitest";
import { createEscalationStore, registerEscalation } from "@/agent/domain/escalations";
import {
  GetTicketInputSchema,
  ListTicketsInputSchema,
  RegisterEscalationInputSchema,
} from "@/agent/domain/schemas";
import { getTicket, listTickets } from "@/agent/domain/tickets";

const ids = (tickets: { id: string }[]) => tickets.map((t) => t.id);

const validEscalation = {
  chamado_id: "CH-101",
  resumo: "Erro 500 ao emitir nota fiscal desde ontem.",
  justificativa: "Cliente impedido de faturar.",
};

describe("listar_chamados (listTickets)", () => {
  it("returns exactly CH-101 and CH-103 for situacao=aberto", () => {
    const result = listTickets({ situacao: "aberto" });
    expect(result.ok && ids(result.data)).toEqual(["CH-101", "CH-103"]);
  });

  it("returns only resolved tickets for situacao=resolvido", () => {
    const result = listTickets({ situacao: "resolvido" });
    expect(result.ok && ids(result.data)).toEqual(["CH-102", "CH-104"]);
  });

  it("returns all tickets without a filter", () => {
    const result = listTickets({});
    expect(result.ok && ids(result.data)).toEqual(["CH-101", "CH-102", "CH-103", "CH-104"]);
  });

  it("returns copies, so callers cannot change the mock data", () => {
    const first = listTickets({ situacao: "aberto" });
    if (first.ok) first.data[0].situacao = "resolvido";

    const second = listTickets({ situacao: "aberto" });
    expect(second.ok && ids(second.data)).toEqual(["CH-101", "CH-103"]);
  });
});

describe("getTicket", () => {
  it("returns the ticket for a known id", () => {
    const result = getTicket({ chamado_id: "CH-102" });
    expect(result).toMatchObject({ ok: true, data: { id: "CH-102", situacao: "resolvido" } });
  });

  it("returns TICKET_NOT_FOUND for an unknown id instead of inventing data", () => {
    const result = getTicket({ chamado_id: "CH-999" });
    expect(result).toMatchObject({ ok: false, error: { code: "TICKET_NOT_FOUND" } });
  });
});

describe("input contracts (Zod)", () => {
  it("accepts only known situacao values", () => {
    expect(ListTicketsInputSchema.safeParse({ situacao: "aberto" }).success).toBe(true);
    expect(ListTicketsInputSchema.safeParse({}).success).toBe(true);
    expect(ListTicketsInputSchema.safeParse({ situacao: "fechado" }).success).toBe(false);
  });

  it("normalizes the ticket id and rejects malformed ones", () => {
    expect(GetTicketInputSchema.parse({ chamado_id: " ch-101 " })).toEqual({ chamado_id: "CH-101" });
    expect(GetTicketInputSchema.safeParse({ chamado_id: "101" }).success).toBe(false);
    expect(GetTicketInputSchema.safeParse({}).success).toBe(false);
  });

  it("requires non-empty resumo and justificativa", () => {
    expect(RegisterEscalationInputSchema.safeParse(validEscalation).success).toBe(true);
    expect(
      RegisterEscalationInputSchema.safeParse({ ...validEscalation, resumo: "   " }).success,
    ).toBe(false);
    expect(
      RegisterEscalationInputSchema.safeParse({ chamado_id: "CH-101", resumo: "x" }).success,
    ).toBe(false);
  });
});

describe("registerEscalation (business guards)", () => {
  it("registers an open ticket", () => {
    const store = createEscalationStore();
    const result = registerEscalation(store, validEscalation);

    expect(result).toMatchObject({ ok: true, data: { id: "ESC-001", chamado_id: "CH-101" } });
    expect(store.list()).toHaveLength(1);
  });

  it("blocks a resolved ticket (CH-102) and writes nothing", () => {
    const store = createEscalationStore();
    const result = registerEscalation(store, { ...validEscalation, chamado_id: "CH-102" });

    expect(result).toMatchObject({ ok: false, error: { code: "TICKET_NOT_OPEN" } });
    expect(store.list()).toHaveLength(0);
  });

  it("blocks an unknown ticket and writes nothing", () => {
    const store = createEscalationStore();
    const result = registerEscalation(store, { ...validEscalation, chamado_id: "CH-999" });

    expect(result).toMatchObject({ ok: false, error: { code: "TICKET_NOT_FOUND" } });
    expect(store.list()).toHaveLength(0);
  });

  it("blocks a second escalation of the same ticket, even with different text (D11)", () => {
    const store = createEscalationStore();
    registerEscalation(store, validEscalation);
    const result = registerEscalation(store, {
      ...validEscalation,
      resumo: "Cliente não consegue emitir notas fiscais.",
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "ALREADY_ESCALATED", message: expect.stringContaining("ESC-001") },
    });
    expect(store.list()).toHaveLength(1);
  });

  it("keeps the ticket untouched: escalations live in a separate collection (D19)", () => {
    const store = createEscalationStore();
    registerEscalation(store, validEscalation);

    expect(getTicket({ chamado_id: "CH-101" })).toMatchObject({
      ok: true,
      data: { situacao: "aberto" },
    });
    expect(store.findByTicketId("CH-101")).toMatchObject({ id: "ESC-001" });
  });

  it("keeps stores isolated from each other", () => {
    const a = createEscalationStore();
    const b = createEscalationStore();
    registerEscalation(a, validEscalation);

    expect(a.list()).toHaveLength(1);
    expect(b.list()).toHaveLength(0);
  });
});
