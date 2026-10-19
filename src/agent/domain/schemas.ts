import { z } from "zod";

// Contracts shared by the domain functions and (from step 3) the LangChain tools.
// Field descriptions are in Portuguese because the model reads them (D06/S3).

export const SituacaoSchema = z.enum(["aberto", "resolvido"]);
export type Situacao = z.infer<typeof SituacaoSchema>;

// Normalizes " ch-101 " to "CH-101" before checking the format.
const TicketIdSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^CH-\d+$/, "Identificador deve ter o formato CH-<número>, ex.: CH-101.");

export const TicketSchema = z.object({
  id: TicketIdSchema,
  title: z.string().min(1),
  description: z.string().min(1),
  customer: z.string().min(1),
  situacao: SituacaoSchema,
});
export type Ticket = z.infer<typeof TicketSchema>;

export const EscalationSchema = z.object({
  id: z.string().regex(/^ESC-\d{3,}$/),
  ticket_id: TicketIdSchema,
  summary: z.string().min(1),
  justification: z.string().min(1),
});
export type Escalation = z.infer<typeof EscalationSchema>;

// --- Tool inputs (what the model must send) ---

export const ListTicketsInputSchema = z.object({
  situacao: SituacaoSchema.optional().describe(
    'Filtra os chamados pela situação ("aberto" ou "resolvido"). Omita para listar todos.',
  ),
});
export type ListTicketsInput = z.infer<typeof ListTicketsInputSchema>;

export const GetTicketInputSchema = z.object({
  ticket_id: TicketIdSchema.describe("Identificador do chamado, ex.: CH-101."),
});
export type GetTicketInput = z.infer<typeof GetTicketInputSchema>;

export const RegisterEscalationInputSchema = z.object({
  ticket_id: TicketIdSchema.describe("Identificador do chamado a escalonar, ex.: CH-101."),
  summary: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .describe("Resumo do problema do chamado, baseado nos dados consultados."),
  justification: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .describe("Justificativa de por que o chamado precisa ser escalonado."),
});
export type RegisterEscalationInput = z.infer<typeof RegisterEscalationInputSchema>;

// --- Tool result: business errors are returned as data, never thrown (S5) ---

export type ErrorCode = "TICKET_NOT_FOUND" | "TICKET_NOT_OPEN" | "ALREADY_ESCALATED";

export type ToolResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ErrorCode; message: string } };

export const ok = <T>(data: T): ToolResult<T> => ({ ok: true, data });

export const fail = <T>(code: ErrorCode, message: string): ToolResult<T> => ({
  ok: false,
  error: { code, message },
});
