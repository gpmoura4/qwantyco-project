import type { StructuredToolInterface } from "@langchain/core/tools";
import { tool } from "@langchain/core/tools";
import type { z } from "zod";
import {
  GetTicketInputSchema,
  ListTicketsInputSchema,
  RegisterEscalationInputSchema,
} from "./domain/schemas";
import { getTicket, listTickets } from "./domain/tickets";

// LangChain tools wrap the pure domain functions. The name, description and
// schema are what the model sees (via bindTools); descriptions are in PT (D15).

export const listarChamadosTool = tool((input) => listTickets(input), {
  name: "listar_chamados",
  description:
    "Lista os chamados de suporte da Aurora. Use o argumento situacao para filtrar " +
    '(por exemplo, "aberto"). Retorna os dados reais dos chamados.',
  schema: ListTicketsInputSchema,
});

export const getTicketTool = tool((input) => getTicket(input), {
  name: "get_ticket",
  description:
    "Consulta um chamado de suporte da Aurora pelo identificador (por exemplo, CH-101) " +
    "e retorna seus dados, incluindo a situação.",
  schema: GetTicketInputSchema,
});

// The model "calls" this tool to propose an escalation. It is never executed
// directly: the executor turns the call into a proposal and the graph waits for
// a human decision (humanApproval node). Running it directly is a bug.
export const registerEscalationTool = tool(
  () => {
    throw new Error("register_escalation only runs after human approval.");
  },
  {
    name: "register_escalation",
    description:
      "Propõe o escalonamento de um chamado aberto para revisão humana. Não registra nada " +
      "imediatamente: o registro só acontece se uma pessoa aprovar a proposta. Consulte o " +
      "chamado antes e baseie o resumo e a justificativa nos dados retornados.",
    schema: RegisterEscalationInputSchema,
  },
);

// Allowlist entry: the tool, the Zod schema the executor validates against, and
// whether it needs human approval instead of direct execution.
export type AllowedTool = {
  tool: StructuredToolInterface;
  schema: z.ZodType;
  requiresApproval?: boolean;
};

export const TOOLS: AllowedTool[] = [
  { tool: listarChamadosTool, schema: ListTicketsInputSchema },
  { tool: getTicketTool, schema: GetTicketInputSchema },
  { tool: registerEscalationTool, schema: RegisterEscalationInputSchema, requiresApproval: true },
];
