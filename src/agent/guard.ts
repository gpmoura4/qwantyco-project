import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";

// Reply guard (D40): checks the model's final answer of a turn against what the
// tools actually returned. It cannot make a small model smart, but it stops two
// PDF violations from reaching the user: claiming an action that did not happen
// and citing tickets/escalations that no tool returned.

export const GUARD_NAME = "reply_guard";

export type ReplyViolation = {
  // Sent to the model once, asking it to fix the answer (it may call the tool now).
  correction: string;
  // Shown to the user if the corrected answer still violates the rule.
  fallback: string;
};

// Claims that a proposal was created/prepared/sent (Portuguese phrasings seen in tests).
const PROPOSAL_CLAIM =
  /propost[ao]\s+(de\s+escalonamento\s+)?(\S+\s+){0,6}?(foi\s+|está\s+)?(criad|preparad|enviad|registrad|gerad)|\b(propus|propusemos|proponho|propor+ei|propor+emos)\b|\b(vou|irei|vamos)\s+propor\b|\bproposto o escalonamento\b|\b(preparei|criei|registrei|enviei)\s+(a|uma)\s+proposta\b|\bvou\s+(registrar|criar|preparar|enviar)\s+(a|uma)\s+proposta\b/i;

const IDS = /\b(?:CH|ESC)-\d+\b/gi;

// Explicit escalation request (imperative). Questions ("já foi escalonado?") are excluded.
const ESCALATION_REQUEST =
  /\b(escalone|escale|escalonar|escalar|escalonem)\b|\bprepar\w*\s+(um\s+|o\s+)?escalonamento\b/i;

const FALLBACK_NO_PROPOSAL =
  "Não consegui preparar a proposta de escalonamento nesta tentativa, e nenhuma proposta foi " +
  'criada. Tente: "Consulte o CH-101 e prepare um escalonamento se ele estiver aberto." ' +
  "(troque CH-101 pelo seu chamado) ou use o botão Preparar escalonamento.";

// Tickets that get_ticket returned in this turn as open and not escalated.
function escalatableInTurn(turn: BaseMessage[]): string[] {
  return turn
    .filter((m) => ToolMessage.isInstance(m) && m.name === "get_ticket")
    .flatMap((m) => {
      try {
        const result = JSON.parse(String(m.content));
        const ticket = result?.ok ? result.data : null;
        return ticket?.situacao === "aberto" && ticket.escalonamento === null ? [ticket.id] : [];
      } catch {
        return [];
      }
    });
}

const isGuardMessage = (m: BaseMessage) => HumanMessage.isInstance(m) && m.name === GUARD_NAME;

// Index of the user message that started the current turn (guard corrections excluded).
function turnStart(messages: BaseMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (HumanMessage.isInstance(messages[i]) && !isGuardMessage(messages[i])) return i;
  }
  return 0;
}

export function alreadyCorrected(messages: BaseMessage[]): boolean {
  return messages.slice(turnStart(messages)).some(isGuardMessage);
}

export function findReplyViolation(messages: BaseMessage[]): ReplyViolation | null {
  const reply = messages.at(-1);
  if (!reply || !AIMessage.isInstance(reply) || typeof reply.content !== "string") return null;
  const text = reply.content;
  const turn = messages.slice(turnStart(messages));

  const proposedThisTurn = turn.some(
    (m) => AIMessage.isInstance(m) && m.tool_calls?.some((c) => c.name === "register_escalation"),
  );
  const userText = String(turn[0]?.content ?? "");
  const eligible = escalatableInTurn(turn);
  const callNow = (id: string) =>
    `Não peça confirmação: chame register_escalation agora com chamado_id "${id}", um resumo e ` +
    "uma justificativa baseados nos dados retornados. A aprovação humana acontece depois.";

  // 1. Escalation explicitly requested, the tools show the ticket can be escalated,
  // but the model did not propose it (it answered or asked instead).
  if (
    !proposedThisTurn &&
    eligible.length > 0 &&
    ESCALATION_REQUEST.test(userText) &&
    !userText.trim().endsWith("?")
  ) {
    return {
      correction:
        `Verificação automática: o usuário pediu o escalonamento e o chamado ${eligible[0]} está ` +
        `aberto e sem escalonamento, mas nenhuma proposta foi criada. ${callNow(eligible[0])}`,
      fallback: FALLBACK_NO_PROPOSAL,
    };
  }

  // 2. Action claimed but not performed in this turn.
  if (!proposedThisTurn && PROPOSAL_CLAIM.test(text)) {
    return {
      correction:
        "Verificação automática: sua resposta afirma que uma proposta de escalonamento foi criada, " +
        "mas você não chamou register_escalation, então nenhuma proposta existe. " +
        (eligible.length > 0
          ? callNow(eligible[0])
          : "Se o chamado estiver aberto e sem escalonamento, chame register_escalation; caso " +
            "contrário, responda sem afirmar que criou uma proposta."),
      fallback: FALLBACK_NO_PROPOSAL,
    };
  }

  // 3. Ticket/escalation ids that no tool returned in this conversation.
  const known = new Set(
    messages
      .filter(ToolMessage.isInstance)
      .flatMap((m) => String(m.content).match(IDS) ?? [])
      .map((id) => id.toUpperCase()),
  );
  const unknown = [...new Set((text.match(IDS) ?? []).map((id) => id.toUpperCase()))].filter(
    (id) => !known.has(id),
  );
  if (unknown.length > 0) {
    return {
      correction:
        `Verificação automática: sua resposta cita ${unknown.join(", ")}, que não aparece em nenhum ` +
        "retorno de ferramenta desta conversa. Consulte as ferramentas antes de citar chamados ou " +
        "escalonamentos, ou remova essas informações da resposta.",
      fallback:
        "A resposta gerada citava dados que não vieram das ferramentas e foi descartada. Tente de " +
        "novo informando o identificador do chamado (por exemplo, CH-101).",
    };
  }

  return null;
}
