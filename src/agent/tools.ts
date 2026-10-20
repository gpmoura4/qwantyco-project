import type { StructuredToolInterface } from "@langchain/core/tools";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  getTicketView,
  listTicketViews,
  type EscalationStore,
} from "./domain/escalations";
import {
  GetTicketInputSchema,
  ListTicketsInputSchema,
  RegisterEscalationInputSchema,
  TicketViewSchema,
  toolResultSchema,
} from "./domain/schemas";

// LangChain tools wrap the pure domain functions. The name, description and
// schema are what the model sees (via bindTools); descriptions are in PT (D15).
// Read tools return the ticket plus its escalation (field `escalonamento`), so
// "was it escalated?" always has a source of truth (D38).

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

// Allowlist entry: the tool, the Zod schemas the executor validates input and
// output against, and whether it needs human approval instead of direct execution.
export type AllowedTool = {
  tool: StructuredToolInterface;
  schema: z.ZodType;
  outputSchema?: z.ZodType;
  requiresApproval?: boolean;
};

// The read tools need the escalation store, so the allowlist is built per runtime.
export function createTools(store: EscalationStore): AllowedTool[] {
  const listarChamadosTool = tool((input) => listTicketViews(store, input), {
    name: "listar_chamados",
    description:
      "Lista os chamados de suporte da Aurora. Use o argumento situacao para filtrar " +
      '(por exemplo, "aberto"). Retorna os dados reais dos chamados, incluindo o campo ' +
      "escalonamento (null se o chamado não foi escalonado).",
    schema: ListTicketsInputSchema,
  });

  const getTicketTool = tool((input) => getTicketView(store, input), {
    name: "get_ticket",
    description:
      "Consulta um chamado de suporte da Aurora pelo identificador (por exemplo, CH-101) e " +
      "retorna seus dados atuais: a situação e o campo escalonamento (null se não foi " +
      "escalonado; caso contrário, o id do escalonamento registrado).",
    schema: GetTicketInputSchema,
  });

  return [
    {
      tool: listarChamadosTool,
      schema: ListTicketsInputSchema,
      outputSchema: toolResultSchema(z.array(TicketViewSchema)),
    },
    {
      tool: getTicketTool,
      schema: GetTicketInputSchema,
      outputSchema: toolResultSchema(TicketViewSchema),
    },
    { tool: registerEscalationTool, schema: RegisterEscalationInputSchema, requiresApproval: true },
  ];
}
