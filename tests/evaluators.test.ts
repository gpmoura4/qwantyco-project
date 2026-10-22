import { AIMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { describe, expect, it } from "vitest";
import { createEscalationStore, getTicketView, listTicketViews } from "@/agent/domain/escalations";
import { fail, type Proposal } from "@/agent/domain/schemas";
import { CASES, type CaseReference } from "../evals/dataset";
import { DEMOS } from "../evals/demo";
import { evaluateCase } from "../evals/evaluators";
import { planSync } from "../evals/sync";
import { runCase, type CaseOutputs, type TurnRecord } from "../evals/target";

// Offline checks of the evaluation (R16–R18): the evaluator passes a correct run
// and fails one that skips the query, invents or omits a ticket. Graph cases go
// through the same graph and executor with a fake model; no LangSmith, no network.

const [LIST_CASE, STATUS_CASE, PADARIA_CASE, TRANSPORTADORA_CASE] = CASES;

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
    expect(PADARIA_CASE.inputs.messages).toEqual(["qual o chamado da Padaria?"]);
    expect(TRANSPORTADORA_CASE.reference).toMatchObject({ kind: "lookup_by_client", expected_id: "CH-103" });
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

describe("Evaluator demonstrations (npm run eval:demo, D50)", () => {
  it.each([
    ["demo-pula-consulta", { tool_called: 0, pass: 0 }],
    ["demo-inventa-chamado", { tool_called: 1, answer_matches_tool: 0, pass: 0 }],
  ])("%s is failed by the evaluator", (name, expected) => {
    const demo = DEMOS.find((d) => d.name === name)!;

    const outputs = demo.target(LIST_CASE.inputs);

    expect(scores(outputs, LIST_CASE.reference)).toMatchObject(expected);
  });
});

describe("Dataset sync plan (D48)", () => {
  // As the API returns them: same content, but keys in another order.
  const asStored = (id: string, c: (typeof CASES)[number]) => ({
    id,
    inputs: JSON.parse(JSON.stringify(c.inputs)),
    outputs: Object.fromEntries(Object.entries(c.reference).reverse()),
  });

  it("creates every case in an empty dataset", () => {
    expect(planSync(CASES, [])).toEqual({ toCreate: CASES, toDelete: [] });
  });

  it("changes nothing when the dataset already matches the code", () => {
    const existing = CASES.map((c, i) => asStored(`ex-${i}`, c));

    expect(planSync(CASES, existing)).toEqual({ toCreate: [], toDelete: [] });
  });

  it("creates a new case and deletes one removed from the code", () => {
    const existing = [
      asStored("ex-0", CASES[0]),
      { id: "ex-old", inputs: { messages: ["Caso antigo."] }, outputs: { kind: "list_open" } },
    ];

    expect(planSync(CASES, existing)).toEqual({ toCreate: CASES.slice(1), toDelete: ["ex-old"] });
  });

  it("replaces a case whose reference changed, and removes duplicates", () => {
    const changed = { ...asStored("ex-0", CASES[0]), outputs: { kind: "list_open", expected_ids: ["CH-101"] } };
    const existing = [changed, asStored("ex-1", CASES[1]), asStored("ex-1-dup", CASES[1])];

    expect(planSync(CASES, existing)).toEqual({
      toCreate: [CASES[0], ...CASES.slice(2)],
      toDelete: ["ex-0", "ex-1-dup"],
    });
  });
});

describe("Lookup by client name (lookup_by_client, D51)", () => {
  const store = createEscalationStore();
  // Real tool results from the domain.
  const listAll = listTicketViews(store, {});
  const ch101 = getTicketView(store, { chamado_id: "CH-101" });

  const lookupOutputs = (
    answer: string,
    call: { name: string; args: Record<string, unknown> },
    result: TurnRecord["tool_results"][number]["result"],
  ): CaseOutputs => ({
    turns: [
      {
        message: "qual o chamado?",
        answer,
        tool_calls: [{ id: "call-1", ...call }],
        tool_results: [{ tool_call_id: "call-1", name: call.name, result }],
        proposal: null,
        decision: null,
        error: null,
      },
    ],
    escalations: [],
  });
  const listCall = { name: "listar_chamados", args: {} };

  it("passes when the ticket came from a tool and the answer names only it", () => {
    const outputs = lookupOutputs("O chamado da Padaria Pão Dourado é o CH-101.", listCall, listAll);

    expect(scores(outputs, PADARIA_CASE.reference)).toEqual({
      ticket_found_by_tool: 1,
      answer_identifies_ticket: 1,
      answer_ids_backed: 1,
      no_side_effects: 1,
      pass: 1,
    });
  });

  it.each([
    ["lists every ticket", "Há o CH-101 (Padaria) e o CH-103 (Transportadora)."],
    ["does not say which one", "Encontrei dois chamados abertos, um da Padaria e outro da Transportadora."],
  ])("fails an answer that %s", (_case, answer) => {
    const outputs = lookupOutputs(answer, listCall, listAll);

    expect(scores(outputs, PADARIA_CASE.reference)).toMatchObject({
      ticket_found_by_tool: 1,
      answer_identifies_ticket: 0,
      pass: 0,
    });
  });

  it("fails a guessed id: get_ticket(CH-101) answered as the Transportadora ticket", () => {
    const outputs = lookupOutputs(
      "O chamado da Transportadora Rota Sul é CH-101.",
      { name: "get_ticket", args: { chamado_id: "CH-101" } },
      ch101,
    );

    expect(scores(outputs, TRANSPORTADORA_CASE.reference)).toMatchObject({
      ticket_found_by_tool: 0,
      answer_identifies_ticket: 0,
      pass: 0,
    });
  });

  it("checks the client too: a reference whose id belongs to another client fails", () => {
    const outputs = lookupOutputs("O chamado da Padaria Pão Dourado é o CH-103.", listCall, listAll);
    const wrongReference: CaseReference = {
      kind: "lookup_by_client",
      cliente: "Padaria Pão Dourado",
      expected_id: "CH-103",
    };

    expect(scores(outputs, wrongReference)).toMatchObject({ ticket_found_by_tool: 0, pass: 0 });
  });

  it("fails an answer that cites a ticket no tool returned", () => {
    const outputs = lookupOutputs("É o CH-101, ligado ao CH-105.", listCall, listAll);

    expect(scores(outputs, PADARIA_CASE.reference)).toMatchObject({ answer_ids_backed: 0, pass: 0 });
  });

  it("fails a lookup that proposed an escalation", () => {
    const outputs = lookupOutputs("O chamado da Padaria Pão Dourado é o CH-101.", listCall, listAll);
    outputs.turns[0].proposal = { id: "prop-1", chamado_id: "CH-101", resumo: "r", justificativa: "j" };

    expect(scores(outputs, PADARIA_CASE.reference)).toMatchObject({ no_side_effects: 0, pass: 0 });
  });

  it("through the graph: listing and naming the right ticket passes", async () => {
    const model = fakeModel()
      .respondWithTools([{ name: "listar_chamados", args: {} }])
      .respond(new AIMessage("O chamado da Transportadora Rota Sul é o CH-103."));

    const outputs = await runCase(model, TRANSPORTADORA_CASE.inputs);

    expect(scores(outputs, TRANSPORTADORA_CASE.reference).pass).toBe(1);
  });

  it("through the graph: the guessed id passes the reply guard but not the evaluator", async () => {
    // The id CH-101 did come from a tool, so the guard (D40) lets it through; only
    // the client check of the evaluator sees that it is the wrong ticket.
    const model = fakeModel()
      .respondWithTools([{ name: "get_ticket", args: { chamado_id: "CH-101" } }])
      .respond(new AIMessage("O chamado da Transportadora Rota Sul é CH-101."));

    const outputs = await runCase(model, TRANSPORTADORA_CASE.inputs);

    expect(outputs.turns[0].answer).toBe("O chamado da Transportadora Rota Sul é CH-101.");
    expect(scores(outputs, TRANSPORTADORA_CASE.reference)).toMatchObject({
      ticket_found_by_tool: 0,
      answer_identifies_ticket: 0,
      pass: 0,
    });
  });
});
