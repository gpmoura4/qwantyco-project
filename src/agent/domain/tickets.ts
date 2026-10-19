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
// evaluation case expects exactly these two, with no extra records (D16).
// Parsed at load time so a malformed mock fails fast.
const TICKETS: readonly Ticket[] = TicketSchema.array().parse([
  {
    id: "CH-101",
    titulo: "Erro ao emitir nota fiscal",
    descricao: "Desde ontem o sistema retorna erro 500 ao emitir nota fiscal eletrônica.",
    cliente: "Padaria Pão Dourado",
    situacao: "aberto",
  },
  {
    id: "CH-102",
    titulo: "Senha bloqueada",
    descricao: "Usuário bloqueado após tentativas de login; senha redefinida pelo suporte.",
    cliente: "Clínica Vida Plena",
    situacao: "resolvido",
  },
  {
    id: "CH-103",
    titulo: "Lentidão no relatório mensal",
    descricao: "O relatório de vendas mensal leva mais de 10 minutos para carregar.",
    cliente: "Transportadora Rota Sul",
    situacao: "aberto",
  },
  {
    id: "CH-104",
    titulo: "Notificações por e-mail não enviadas",
    descricao: "Notificações por e-mail falhavam; certificado do servidor SMTP renovado.",
    cliente: "Escola Saber Mais",
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
  const ticket = TICKETS.find((t) => t.id === input.chamado_id);
  if (!ticket) {
    return fail("TICKET_NOT_FOUND", `Chamado ${input.chamado_id} não encontrado.`);
  }
  return ok({ ...ticket });
}
