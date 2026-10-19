import type { StructuredToolInterface } from "@langchain/core/tools";
import { tool } from "@langchain/core/tools";
import type { z } from "zod";
import { GetTicketInputSchema, ListTicketsInputSchema } from "./domain/schemas";
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

// Allowlist entry: the tool plus the Zod schema the executor validates against.
export type AllowedTool = { tool: StructuredToolInterface; schema: z.ZodType };

// Step 3: read-only tools only. register_escalation joins in step 4 together
// with the human approval (interrupt), so it can never run without approval.
export const READ_ONLY_TOOLS: AllowedTool[] = [
  { tool: listarChamadosTool, schema: ListTicketsInputSchema },
  { tool: getTicketTool, schema: GetTicketInputSchema },
];
