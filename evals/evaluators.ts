import type { TicketView } from "@/agent/domain/schemas";
import type { CaseReference } from "./dataset";
import type { CaseOutputs } from "./target";

// Code evaluators (R16–R18). They only read the target's record of what ran (tool
// calls and the results the executor produced), never the model's description of
// it. Each criterion is a separate score, so the LangSmith experiment shows which
// one failed; `pass` is 1 only when all of them are 1. Comments are in PT (UI text).

export type Score = { key: string; score: 0 | 1; comment: string };

const score = (key: string, passed: boolean, comment: string): Score => ({
  key,
  score: passed ? 1 : 0,
  comment,
});

const withPass = (scores: Score[]): { results: Score[] } => ({
  results: [
    ...scores,
    score(
      "pass",
      scores.every((s) => s.score === 1),
      scores.filter((s) => s.score === 0).map((s) => s.key).join(", ") || "todos os critérios ok",
    ),
  ],
});

const TICKET_IDS = /\bCH-\d+\b/gi;
const ANY_IDS = /\b(?:CH|ESC)-\d+\b/gi;

const idsIn = (text: string, pattern: RegExp) => [
  ...new Set((text.match(pattern) ?? []).map((id) => id.toUpperCase())),
];

const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && a.every((id) => b.includes(id));

const list = (ids: string[]) => (ids.length ? ids.join(", ") : "nenhum");

export function evaluateCase({
  outputs,
  referenceOutputs,
}: {
  outputs: CaseOutputs;
  referenceOutputs: CaseReference;
}): { results: Score[] } {
  return referenceOutputs.kind === "list_open"
    ? evaluateListOpen(outputs, referenceOutputs.expected_ids)
    : evaluateStatusAfterApproval(outputs, referenceOutputs.chamado_id);
}

// Mandatory case: listar_chamados really ran with {"situacao":"aberto"}, it
// succeeded, and the answer has exactly the tickets it returned.
function evaluateListOpen(outputs: CaseOutputs, expected: string[]): { results: Score[] } {
  const turn = outputs.turns[0];
  const call = turn?.tool_calls.find(
    (c) =>
      c.name === "listar_chamados" &&
      Object.keys(c.args).length === 1 &&
      c.args.situacao === "aberto",
  );
  const result = call && turn.tool_results.find((r) => r.tool_call_id === call.id)?.result;
  const returned =
    result?.ok && Array.isArray(result.data) ? (result.data as TicketView[]).map((t) => t.id) : [];
  const answered = idsIn(turn?.answer ?? "", TICKET_IDS);
  const missing = returned.filter((id) => !answered.includes(id));
  const extra = answered.filter((id) => !returned.includes(id));
  const proposals = outputs.turns.filter((t) => t.proposal).length;

  return withPass([
    score(
      "tool_called",
      Boolean(call),
      call
        ? 'listar_chamados executada com {"situacao":"aberto"}'
        : `nenhuma execução de listar_chamados com {"situacao":"aberto"}; chamadas: ${
            JSON.stringify(turn?.tool_calls.map(({ name, args }) => ({ name, args })) ?? [])
          }`,
    ),
    score(
      "tool_succeeded",
      result?.ok === true,
      result ? (result.ok ? "consulta com sucesso" : `consulta falhou: ${result.error.code}`) : "sem resultado da ferramenta",
    ),
    score(
      "tool_matches_reference",
      result?.ok === true && sameSet(returned, expected),
      `retornados: ${list(returned)}; esperados: ${list(expected)}`,
    ),
    score(
      "answer_matches_tool",
      result?.ok === true && missing.length === 0 && extra.length === 0,
      `na resposta: ${list(answered)}; omitidos: ${list(missing)}; extras ou inventados: ${list(extra)}`,
    ),
    score(
      "no_side_effects",
      proposals === 0 && outputs.escalations.length === 0,
      `propostas: ${proposals}; escalonamentos registrados: ${outputs.escalations.length}`,
    ),
  ]);
}

// Claims in PT. A negation near "escalonad..." wins over the affirmation.
const NEGATED = /\bnão\s+(?:\S+\s+){0,4}?escalonad|\b(?:sem|nenhum)\s+escalonamento\b/i;
const AFFIRMED = /\bescalonad[oa]\b|\bESC-\d+\b/i;

// Additional case (P10, D38): after an approved escalation, the answer about the
// ticket's status agrees with the latest tool result and invents nothing.
function evaluateStatusAfterApproval(outputs: CaseOutputs, chamadoId: string): { results: Score[] } {
  const approved = outputs.turns.find(
    (t) => t.proposal?.chamado_id === chamadoId && t.decision === "aprovar",
  );
  const registered = outputs.escalations.find((e) => e.chamado_id === chamadoId);

  // Latest view of the ticket in any tool result of the conversation (get_ticket,
  // listar_chamados or the approval result, which has the same shape).
  const views = outputs.turns.flatMap((t) =>
    t.tool_results.flatMap(({ result }) => {
      if (!result.ok) return [];
      const data = Array.isArray(result.data) ? result.data : [result.data];
      return (data as TicketView[]).filter((v) => v?.id === chamadoId);
    }),
  );
  const latest = views.at(-1);
  const escalated = Boolean(latest?.escalonamento);

  const last = outputs.turns.at(-1);
  const answer = last?.answer ?? "";
  const says = NEGATED.test(answer) ? "não escalonado" : AFFIRMED.test(answer) ? "escalonado" : "não diz";
  const agrees = latest !== undefined && (escalated ? says === "escalonado" : says !== "escalonado");

  const known = new Set(outputs.turns.flatMap((t) => idsIn(JSON.stringify(t.tool_results), ANY_IDS)));
  const unknown = idsIn(answer, ANY_IDS).filter((id) => !known.has(id));

  return withPass([
    score(
      "escalation_registered",
      Boolean(approved && registered),
      approved
        ? registered
          ? `proposta aprovada e ${registered.id} registrado`
          : "proposta aprovada, mas nada registrado"
        : `nenhuma proposta para ${chamadoId} foi aprovada`,
    ),
    score(
      "answer_matches_status",
      agrees,
      latest
        ? `último resultado: escalonamento ${latest.escalonamento ? latest.escalonamento.id : "null"}; resposta: ${says}`
        : `nenhum resultado de ferramenta com ${chamadoId}`,
    ),
    score(
      "answer_ids_backed",
      unknown.length === 0,
      `ids sem fonte nas ferramentas: ${list(unknown)}`,
    ),
  ]);
}
