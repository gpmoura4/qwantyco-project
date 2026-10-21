import { AIMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { describe, expect, it } from "vitest";
import { createEscalationStore, listTicketViews } from "@/agent/domain/escalations";
import { fail, type Proposal } from "@/agent/domain/schemas";
import { CASES, type CaseReference } from "../evals/dataset";
import { evaluateCase } from "../evals/evaluators";
import { runCase, type CaseOutputs, type TurnRecord } from "../evals/target";

// Offline checks of the evaluation (R16–R18): the evaluator passes a correct run
// and fails one that skips the query, invents or omits a ticket. Graph cases go
// through the same graph and executor with a fake model; no LangSmith, no network.

const [LIST_CASE, STATUS_CASE] = CASES;

const scores = (outputs: CaseOutputs, reference: CaseReference) =>
  Object.fromEntries(
    evaluateCase({ outputs, referenceOutputs: reference }).results.map((r) => [r.key, r.score]),
  );

// A turn record as the target would produce it, with the real listar_chamados result.
function listTurn(overrides: Partial<TurnRecord> = {}): TurnRecord {
  return {
    message: "Liste todos os chamados abertos.",
    answer: "Os chamados abertos são CH-101 e CH-103.",
    tool_calls: [{ id: "call-1", name: "listar_chamados", args: { situacao: "aberto" } }],
    tool_results: [
      {
        tool_call_id: "call-1",
        name: "listar_chamados",
        result: listTicketViews(createEscalationStore(), { situacao: "aberto" }),
      },
    ],
    proposal: null,
    decision: null,
    error: null,
    ...overrides,
  };
}

const listOutputs = (overrides: Partial<TurnRecord> = {}): CaseOutputs => ({
  turns: [listTurn(overrides)],
  escalations: [],
});

describe("Dataset", () => {
  it("has the mandatory case exactly as in the PDF, plus the additional case", () => {
    expect(LIST_CASE.inputs.messages).toEqual(["Liste todos os chamados abertos."]);
    expect(LIST_CASE.reference).toEqual({ kind: "list_open", expected_ids: ["CH-101", "CH-103"] });
    expect(STATUS_CASE.reference.kind).toBe("status_after_approval");
  });
});

describe("Mandatory case evaluator (list_open)", () => {
  it("passes when the tool ran and the answer has exactly its tickets", () => {
    expect(scores(listOutputs(), LIST_CASE.reference)).toEqual({
      tool_called: 1,
      tool_succeeded: 1,
      tool_matches_reference: 1,
      answer_matches_tool: 1,
      no_side_effects: 1,
      pass: 1,
    });
  });

  it("fails an answer that skipped the query, even with the right text", () => {
    const result = scores(listOutputs({ tool_calls: [], tool_results: [] }), LIST_CASE.reference);
    expect(result).toMatchObject({ tool_called: 0, tool_succeeded: 0, answer_matches_tool: 0, pass: 0 });
  });

  it("fails an answer that invents a ticket", () => {
    const result = scores(
      listOutputs({ answer: "Abertos: CH-101, CH-103 e CH-105." }),
      LIST_CASE.reference,
    );
    expect(result).toMatchObject({ tool_called: 1, answer_matches_tool: 0, pass: 0 });
  });

  it("fails an answer that omits a ticket the tool returned", () => {
    const result = scores(listOutputs({ answer: "O único aberto é o CH-101." }), LIST_CASE.reference);
    expect(result).toMatchObject({ answer_matches_tool: 0, pass: 0 });
  });

  it.each([
    ["another situacao", { situacao: "resolvido" }],
    ["no filter", {}],
    ["an extra argument", { situacao: "aberto", cliente: "Padaria Pão Dourado" }],
  ])("fails a call with %s", (_case, args) => {
    const outputs = listOutputs({
      tool_calls: [{ id: "call-1", name: "listar_chamados", args }],
    });
    expect(scores(outputs, LIST_CASE.reference)).toMatchObject({ tool_called: 0, pass: 0 });
  });

  it("fails when the query did not succeed", () => {
    const outputs = listOutputs({
      tool_results: [
        { tool_call_id: "call-1", name: "listar_chamados", result: fail("INVALID_OUTPUT", "x") },
      ],
    });
    expect(scores(outputs, LIST_CASE.reference)).toMatchObject({ tool_succeeded: 0, pass: 0 });
  });

  it("fails a run that proposed an escalation while listing", () => {
    const proposal: Proposal = { id: "prop-1", chamado_id: "CH-101", resumo: "r", justificativa: "j" };
    const outputs = listOutputs({ proposal, decision: "rejeitar" });
    expect(scores(outputs, LIST_CASE.reference)).toMatchObject({ no_side_effects: 0, pass: 0 });
  });
});

describe("Mandatory case through the graph (fake model)", () => {
  const listOpen = { name: "listar_chamados", args: { situacao: "aberto" } };

  it("a model that queries and answers from the result passes", async () => {
    const model = fakeModel()
      .respondWithTools([listOpen])
      .respond(new AIMessage("Chamados abertos: CH-101 e CH-103."));

    const outputs = await runCase(model, LIST_CASE.inputs);

    expect(scores(outputs, LIST_CASE.reference).pass).toBe(1);
  });

  it("a model that skips the query fails", async () => {
    // Answers twice from memory: the reply guard asks once for a fix, then gives up.
    const skip = new AIMessage("Os chamados abertos são CH-101 e CH-103.");
    const model = fakeModel().respond(skip).respond(skip);

    const outputs = await runCase(model, LIST_CASE.inputs);

    expect(scores(outputs, LIST_CASE.reference)).toMatchObject({ tool_called: 0, pass: 0 });
  });

  it("a model that invents a ticket fails", async () => {
    const invented = new AIMessage("Chamados abertos: CH-101, CH-103 e CH-105.");
    const model = fakeModel().respondWithTools([listOpen]).respond(invented).respond(invented);

    const outputs = await runCase(model, LIST_CASE.inputs);

    expect(scores(outputs, LIST_CASE.reference)).toMatchObject({
      tool_called: 1,
      answer_matches_tool: 0,
      pass: 0,
    });
  });
});

describe("Additional case through the graph (status after approval, P10)", () => {
  const getTicket = { name: "get_ticket", args: { chamado_id: "CH-101" } };
  const escalate = {
    name: "register_escalation",
    args: { chamado_id: "CH-101", resumo: "Erro 500 na NF.", justificativa: "Cliente parado." },
  };

  const approvedThenAsked = (answer: string) =>
    fakeModel()
      .respondWithTools([getTicket])
      .respondWithTools([escalate])
      .respond(new AIMessage(answer));

  it("passes when the answer agrees with the escalation in the latest result", async () => {
    const outputs = await runCase(
      approvedThenAsked("Sim, o CH-101 já foi escalonado (ESC-001)."),
      STATUS_CASE.inputs,
    );

    expect(outputs.escalations).toHaveLength(1);
    expect(scores(outputs, STATUS_CASE.reference)).toEqual({
      escalation_registered: 1,
      answer_matches_status: 1,
      answer_ids_backed: 1,
      pass: 1,
    });
  });

  it.each([
    "O CH-101 está aberto e ainda não foi escalonado.",
    "O CH-101 está aberto, sem escalonamento.",
    "O CH-101 está aberto.",
  ])("fails an answer that contradicts the tools: %s", async (answer) => {
    const outputs = await runCase(approvedThenAsked(answer), STATUS_CASE.inputs);

    expect(scores(outputs, STATUS_CASE.reference)).toMatchObject({
      escalation_registered: 1,
      answer_matches_status: 0,
      pass: 0,
    });
  });

  it("fails an answer that cites an escalation no tool returned", async () => {
    // Real run, then only the final answer is swapped (the reply guard would catch
    // this in the graph; here the evaluator must catch it on its own).
    const outputs = await runCase(
      approvedThenAsked("Sim, o CH-101 já foi escalonado (ESC-001)."),
      STATUS_CASE.inputs,
    );
    outputs.turns.at(-1)!.answer = "Sim, o CH-101 foi escalonado como ESC-002.";

    expect(scores(outputs, STATUS_CASE.reference)).toMatchObject({
      answer_matches_status: 1,
      answer_ids_backed: 0,
      pass: 0,
    });
  });

  it("fails when the model never proposes the escalation", async () => {
    const noProposal = new AIMessage("O CH-101 está aberto.");
    const model = fakeModel()
      .respondWithTools([getTicket])
      .respond(noProposal)
      .respond(noProposal)
      .respond(new AIMessage("O CH-101 não foi escalonado."));

    const outputs = await runCase(model, STATUS_CASE.inputs);

    expect(outputs.escalations).toHaveLength(0);
    expect(scores(outputs, STATUS_CASE.reference)).toMatchObject({
      escalation_registered: 0,
      pass: 0,
    });
  });
});
