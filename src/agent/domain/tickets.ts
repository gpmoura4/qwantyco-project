import {
  fail,
  ok,
  TicketSchema,
  type GetTicketInput,
  type ListTicketsInput,
  type Ticket,
  type ToolResult,
} from "./schemas";

// Fictitious data. Only CH-101 and CH-103 may be "aberto": the mandatory
// evaluation case expects exactly these two, with no extra records (P1).
// Parsed at load time so a malformed mock fails fast.
const TICKETS: readonly Ticket[] = TicketSchema.array().parse([
  {
    id: "CH-101",
    title: "Erro ao emitir nota fiscal",
    description: "Desde ontem o sistema retorna erro 500 ao emitir nota fiscal eletrônica.",
    customer: "Padaria Pão Dourado",
    situacao: "aberto",
  },
  {
    id: "CH-102",
    title: "Senha bloqueada",
    description: "Usuário bloqueado após tentativas de login; senha redefinida pelo suporte.",
    customer: "Clínica Vida Plena",
    situacao: "resolvido",
  },
  {
    id: "CH-103",
    title: "Lentidão no relatório mensal",
    description: "O relatório de vendas mensal leva mais de 10 minutos para carregar.",
    customer: "Transportadora Rota Sul",
    situacao: "aberto",
  },
  {
    id: "CH-104",
    title: "Notificações por e-mail não enviadas",
    description: "Notificações por e-mail falhavam; certificado do servidor SMTP renovado.",
    customer: "Escola Saber Mais",
    situacao: "resolvido",
  },
]);

// Returns copies so callers can never mutate the mock data.
export function listTickets(input: ListTicketsInput): ToolResult<Ticket[]> {
  const tickets = input.situacao
    ? TICKETS.filter((t) => t.situacao === input.situacao)
    : TICKETS;
  return ok(tickets.map((t) => ({ ...t })));
}

export function getTicket(input: GetTicketInput): ToolResult<Ticket> {
  const ticket = TICKETS.find((t) => t.id === input.ticket_id);
  if (!ticket) {
    return fail("TICKET_NOT_FOUND", `Chamado ${input.ticket_id} não encontrado.`);
  }
  return ok({ ...ticket });
}
