import { z } from "zod";

// Contracts shared by the domain functions and (from step 3) the LangChain tools.
// Domain field names are in Portuguese, consistent with the mandatory `situacao` (D20).
// Field descriptions are in Portuguese because the model reads them (D15).

export const SituacaoSchema = z.enum(["aberto", "resolvido"]);
export type Situacao = z.infer<typeof SituacaoSchema>;

// Normalizes " ch-101 " to "CH-101" before checking the format.
const ChamadoIdSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^CH-\d+$/, "Identificador deve ter o formato CH-<número>, ex.: CH-101.");

export const TicketSchema = z.object({
  id: ChamadoIdSchema,
  titulo: z.string().min(1),
  descricao: z.string().min(1),
  cliente: z.string().min(1),
  situacao: SituacaoSchema,
});
export type Ticket = z.infer<typeof TicketSchema>;

// Escalations live in their own collection; registering one never changes the ticket (D19).
export const EscalationSchema = z.object({
  id: z.string().regex(/^ESC-\d{3,}$/),
  proposta_id: z.string().min(1),
  chamado_id: ChamadoIdSchema,
  resumo: z.string().min(1),
  justificativa: z.string().min(1),
});
export type Escalation = z.infer<typeof EscalationSchema>;

// --- Human approval ---

// What the human sees and approves: exactly what will be registered.
export const ProposalSchema = z.object({
  id: z.string().min(1),
  chamado_id: ChamadoIdSchema,
  resumo: z.string().min(1),
  justificativa: z.string().min(1),
});
export type Proposal = z.infer<typeof ProposalSchema>;

// The resume value: a decision is always tied to one specific proposal.
export const DecisionSchema = z.object({
  proposta_id: z.string().min(1),
  decisao: z.enum(["aprovar", "rejeitar"]),
});
export type Decision = z.infer<typeof DecisionSchema>;

// --- Tool inputs (what the model must send) ---

export const ListTicketsInputSchema = z.object({
  situacao: SituacaoSchema.optional().describe(
    'Filtra os chamados pela situação ("aberto" ou "resolvido"). Omita para listar todos.',
  ),
});
export type ListTicketsInput = z.infer<typeof ListTicketsInputSchema>;

export const GetTicketInputSchema = z.object({
  chamado_id: ChamadoIdSchema.describe("Identificador do chamado, ex.: CH-101."),
});
export type GetTicketInput = z.infer<typeof GetTicketInputSchema>;

export const RegisterEscalationInputSchema = z.object({
  chamado_id: ChamadoIdSchema.describe("Identificador do chamado a escalonar, ex.: CH-101."),
  resumo: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .describe("Resumo do problema do chamado, baseado nos dados consultados."),
  justificativa: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .describe("Justificativa de por que o chamado precisa ser escalonado."),
});
export type RegisterEscalationInput = z.infer<typeof RegisterEscalationInputSchema>;

// --- Tool result: business errors are returned as data, never thrown (D17) ---

export type ErrorCode =
  // business rules (domain functions)
  | "TICKET_NOT_FOUND"
  | "TICKET_NOT_OPEN"
  | "ALREADY_ESCALATED"
  // executor checks (tool call rejected before running)
  | "UNKNOWN_TOOL"
  | "INVALID_ARGS"
  // human approval
  | "PROPOSAL_ALREADY_PENDING"
  | "ESCALATION_REJECTED"
  | "NO_PENDING_PROPOSAL"
  | "PROPOSAL_MISMATCH"
  // failures and limits
  | "INVALID_OUTPUT"
  | "EXECUTION_LIMIT"
  | "EXECUTION_FAILED";

export type ToolResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ErrorCode; message: string } };

// Output contract of a tool: a ToolResult whose data matches `data`. The executor
// checks every tool output against it before the model sees anything.
export const toolResultSchema = <T extends z.ZodType>(data: T) =>
  z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), data }),
    z.object({
      ok: z.literal(false),
      error: z.object({ code: z.string(), message: z.string() }),
    }),
  ]);

export const ok = <T>(data: T): ToolResult<T> => ({ ok: true, data });

export const fail = <T>(code: ErrorCode, message: string): ToolResult<T> => ({
  ok: false,
  error: { code, message },
});
