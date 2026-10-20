import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { MemorySaver } from "@langchain/langgraph";
import { describe, expect, it } from "vitest";
import { getPendingProposal } from "@/agent/approval";
import { createEscalationStore } from "@/agent/domain/escalations";
import { buildGraph } from "@/agent/graph";
import { findReplyViolation, GUARD_NAME } from "@/agent/guard";

// Reply guard (D40): the final answer is checked against what the tools returned.

const session = (threadId: string) => ({ configurable: { thread_id: threadId } });
const ask = (text: string) => ({ messages: [new HumanMessage(text)] });

function setup() {
  const model = fakeModel();
  const escalationStore = createEscalationStore();
  const graph = buildGraph({ model, checkpointer: new MemorySaver(), escalationStore });
  return { model, escalationStore, graph };
}

const getCH101 = { name: "get_ticket", args: { chamado_id: "CH-101" } };
const CLAIM = "Proposta de escalonamento para o chamado CH-101 foi criada. Aguarde a aprovação.";

describe("Claimed action without the tool call", () => {
  it("asks the model once to fix it; the model then calls register_escalation", async () => {
    const ctx = setup();
    ctx.model
      .respondWithTools([getCH101])
      .respond(new AIMessage(CLAIM))
      .respondWithTools([
        {
          name: "register_escalation",
          args: { chamado_id: "CH-101", resumo: "Erro 500.", justificativa: "Cliente parado." },
        },
      ]);

    await ctx.graph.invoke(ask("escalone o chamado do pão dourado"), session("s1"));

    // The approval card now has a real proposal behind it.
    expect(await getPendingProposal(ctx.graph, "s1")).toMatchObject({ chamado_id: "CH-101" });
    const state = await ctx.graph.getState(session("s1"));
    const texts = state.values.messages.map((m: { content: unknown }) => m.content);
    expect(texts).not.toContain(CLAIM); // the false claim was removed from the history
    // The correction was sent to the model as a message marked as coming from the guard.
    const lastCall = ctx.model.calls[2].messages;
    expect(lastCall.at(-1)).toMatchObject({ name: GUARD_NAME });
  });

  it("replaces the answer with an honest message if the model insists", async () => {
    const ctx = setup();
    ctx.model.respondWithTools([getCH101]).respond(new AIMessage(CLAIM)).respond(new AIMessage(CLAIM));

    const result = await ctx.graph.invoke(ask("escalone o chamado do pão dourado"), session("s1"));

    expect(result.messages.at(-1)?.content).toContain("nenhuma proposta foi criada");
    expect(await getPendingProposal(ctx.graph, "s1")).toBeNull();
    expect(ctx.escalationStore.list()).toHaveLength(0);
    expect(ctx.model.callCount).toBe(3); // one correction only, no loop
  });
});

describe("Escalation explicitly requested but not proposed", () => {
  it("pushes the model to call register_escalation instead of asking for confirmation", async () => {
    const ctx = setup();
    ctx.model
      .respondWithTools([getCH101])
      .respond(new AIMessage("O CH-101 está aberto. Deseja que eu proponha o escalonamento?"))
      .respondWithTools([
        {
          name: "register_escalation",
          args: { chamado_id: "CH-101", resumo: "Erro 500.", justificativa: "Cliente parado." },
        },
      ]);

    await ctx.graph.invoke(ask("Escalone o CH-101."), session("s1"));

    expect(await getPendingProposal(ctx.graph, "s1")).toMatchObject({ chamado_id: "CH-101" });
    expect(String(ctx.model.calls[2].messages.at(-1)?.content)).toContain('chamado_id "CH-101"');
  });
});

describe("Data not backed by tool results", () => {
  it("removes an invented ticket after one correction", async () => {
    const ctx = setup();
    ctx.model
      .respondWithTools([{ name: "listar_chamados", args: { situacao: "aberto" } }])
      .respond(new AIMessage("Abertos: CH-101, CH-103 e CH-105."))
      .respond(new AIMessage("Abertos: CH-101 e CH-103."));

    const result = await ctx.graph.invoke(ask("Liste os abertos."), session("s1"));

    expect(result.messages.at(-1)?.content).toBe("Abertos: CH-101 e CH-103.");
    expect(String(ctx.model.calls[2].messages.at(-1)?.content)).toContain("CH-105");
  });

  it("replaces an answer that keeps citing an invented ticket", async () => {
    const ctx = setup();
    ctx.model
      .respond(new AIMessage("O CH-101 está aberto."))
      .respond(new AIMessage("O CH-101 está aberto, com certeza."));

    const result = await ctx.graph.invoke(ask("Como está o CH-101?"), session("s1"));

    expect(result.messages.at(-1)?.content).toContain("não vieram das ferramentas");
  });
});

describe("findReplyViolation does not block legitimate answers", () => {
  const toolResult = (content: string) =>
    new ToolMessage({ content, tool_call_id: "t1", name: "get_ticket" });

  it("accepts ids that came from tool results", () => {
    const messages = [
      new HumanMessage("O CH-101 foi escalonado?"),
      new AIMessage({ content: "", tool_calls: [{ ...getCH101, id: "t1", type: "tool_call" }] }),
      toolResult('{"ok":true,"data":{"id":"CH-101","escalonamento":{"id":"ESC-001"}}}'),
      new AIMessage("Sim, o CH-101 foi escalonado (ESC-001)."),
    ];
    expect(findReplyViolation(messages)).toBeNull();
  });

  it("accepts a proposal statement when register_escalation was called in the turn", () => {
    const messages = [
      new HumanMessage("Escalone o CH-101."),
      new AIMessage({
        content: "Preparei uma proposta de escalonamento.",
        tool_calls: [{ name: "register_escalation", args: {}, id: "t2", type: "tool_call" }],
      }),
      toolResult('{"ok":true,"data":{"id":"CH-101"}}'),
      new AIMessage("A proposta de escalonamento foi criada para o CH-101."),
    ];
    expect(findReplyViolation(messages)).toBeNull();
  });

  it.each([
    "Proporrei o escalonamento para revisão humana.",
    "Vou propor o escalonamento do chamado.",
    "Proposta de escalonamento para o chamado foi criada.",
    "Preparei uma proposta para aprovação.",
  ])("flags a proposal claim without register_escalation: %s", (claim) => {
    expect(findReplyViolation([new HumanMessage("escalone"), new AIMessage(claim)])).not.toBeNull();
  });

  const getTicketResult = (situacao: string, escalonamento: unknown) =>
    new ToolMessage({
      content: JSON.stringify({ ok: true, data: { id: "CH-101", situacao, escalonamento } }),
      tool_call_id: "t1",
      name: "get_ticket",
    });
  const turnWith = (user: string, result: ToolMessage, reply: string) => [
    new HumanMessage(user),
    new AIMessage({ content: "", tool_calls: [{ ...getCH101, id: "t1", type: "tool_call" }] }),
    result,
    new AIMessage(reply),
  ];

  it("does not push an escalation for a question", () => {
    const messages = turnWith(
      "O CH-101 já foi escalonado?",
      getTicketResult("aberto", null),
      "Não, o CH-101 não foi escalonado.",
    );
    expect(findReplyViolation(messages)).toBeNull();
  });

  it("does not push an escalation for a resolved ticket", () => {
    const messages = turnWith(
      "Escalone o CH-101.",
      getTicketResult("resolvido", null),
      "O CH-101 está resolvido e não pode ser escalonado.",
    );
    expect(findReplyViolation(messages)).toBeNull();
  });

  it("accepts answers without ids or claims", () => {
    expect(findReplyViolation([new HumanMessage("Oi"), new AIMessage("Olá! Como posso ajudar?")])).toBeNull();
  });
});
