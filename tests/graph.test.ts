import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { MemorySaver } from "@langchain/langgraph";
import { describe, expect, it } from "vitest";
import { buildGraph } from "@/agent/graph";

// Offline tests: a scripted fake model goes through the real graph and executor.

const session = (threadId: string) => ({ configurable: { thread_id: threadId } });

const ask = (text: string) => ({ messages: [new HumanMessage(text)] });

const toolMessages = (messages: BaseMessage[]) => messages.filter(ToolMessage.isInstance);

const toolResult = (message: ToolMessage) => JSON.parse(message.content as string);

const texts = (messages: BaseMessage[]) => messages.map((m) => m.content);

describe("T01 — query and listing use the real tool result", () => {
  it("runs listar_chamados with situacao=aberto and feeds the result back to the model", async () => {
    const model = fakeModel()
      .respondWithTools([{ name: "listar_chamados", args: { situacao: "aberto" }, id: "call-1" }])
      .respond(new AIMessage("Chamados abertos: CH-101 e CH-103."));
    const graph = buildGraph({ model, checkpointer: new MemorySaver() });

    const result = await graph.invoke(ask("Liste todos os chamados abertos."), session("s1"));

    const [toolMessage] = toolMessages(result.messages);
    expect(toolMessage).toMatchObject({ name: "listar_chamados", tool_call_id: "call-1" });
    expect(toolResult(toolMessage).data.map((t: { id: string }) => t.id)).toEqual([
      "CH-101",
      "CH-103",
    ]);
    // The second model call received the tool output, so the answer is based on it.
    expect(model.callCount).toBe(2);
    expect(model.calls[1].messages).toContainEqual(toolMessage);
    expect(result.messages.at(-1)?.content).toBe("Chamados abertos: CH-101 e CH-103.");
  });

  it("runs get_ticket with a normalized id", async () => {
    const model = fakeModel()
      .respondWithTools([{ name: "get_ticket", args: { chamado_id: "ch-101" } }])
      .respond(new AIMessage("O CH-101 está aberto."));
    const graph = buildGraph({ model, checkpointer: new MemorySaver() });

    const result = await graph.invoke(ask("Consulte o ch-101."), session("s1"));

    const [toolMessage] = toolMessages(result.messages);
    expect(toolMessage.status).toBe("success");
    expect(toolResult(toolMessage)).toMatchObject({
      ok: true,
      data: { id: "CH-101", situacao: "aberto" },
    });
  });

  it("returns TICKET_NOT_FOUND for an unknown ticket instead of inventing data", async () => {
    const model = fakeModel()
      .respondWithTools([{ name: "get_ticket", args: { chamado_id: "CH-999" } }])
      .respond(new AIMessage("O chamado CH-999 não foi encontrado."));
    const graph = buildGraph({ model, checkpointer: new MemorySaver() });

    const result = await graph.invoke(ask("Consulte o CH-999."), session("s1"));

    const [toolMessage] = toolMessages(result.messages);
    expect(toolMessage.status).toBe("error");
    expect(toolResult(toolMessage)).toMatchObject({
      ok: false,
      error: { code: "TICKET_NOT_FOUND" },
    });
  });
});

describe("Executor guards — the model is never trusted", () => {
  it("rejects an unknown tool without running anything", async () => {
    const model = fakeModel()
      .respondWithTools([{ name: "delete_ticket", args: { chamado_id: "CH-101" } }])
      .respond(new AIMessage("Não posso fazer isso."));
    const graph = buildGraph({ model, checkpointer: new MemorySaver() });

    const result = await graph.invoke(ask("Apague o CH-101."), session("s1"));

    expect(toolResult(toolMessages(result.messages)[0])).toMatchObject({
      ok: false,
      error: { code: "UNKNOWN_TOOL" },
    });
  });

  it("rejects register_escalation: it is not enabled before the approval flow (step 4)", async () => {
    const model = fakeModel()
      .respondWithTools([
        {
          name: "register_escalation",
          args: { chamado_id: "CH-101", resumo: "x", justificativa: "y" },
        },
      ])
      .respond(new AIMessage("Não consigo registrar escalonamentos."));
    const graph = buildGraph({ model, checkpointer: new MemorySaver() });

    const result = await graph.invoke(ask("Escalone o CH-101."), session("s1"));

    expect(toolResult(toolMessages(result.messages)[0])).toMatchObject({
      ok: false,
      error: { code: "UNKNOWN_TOOL" },
    });
  });

  it("rejects invalid arguments before executing the tool", async () => {
    const model = fakeModel()
      .respondWithTools([
        { name: "listar_chamados", args: { situacao: "fechado" } },
        { name: "get_ticket", args: { id: "CH-101" } },
      ])
      .respond(new AIMessage("Argumentos inválidos."));
    const graph = buildGraph({ model, checkpointer: new MemorySaver() });

    const result = await graph.invoke(ask("Liste os fechados e o CH-101."), session("s1"));

    const results = toolMessages(result.messages).map(toolResult);
    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r).toMatchObject({ ok: false, error: { code: "INVALID_ARGS" } });
    }
  });
});

describe("T07 — context and sessions", () => {
  it("keeps context within a session and isolates different sessions", async () => {
    const model = fakeModel()
      .respond(new AIMessage("Olá, Padaria Pão Dourado!"))
      .respond(new AIMessage("Sua empresa é a Padaria Pão Dourado."))
      .respond(new AIMessage("Não sei o nome da sua empresa."));
    const graph = buildGraph({ model, checkpointer: new MemorySaver() });

    await graph.invoke(ask("Sou da Padaria Pão Dourado."), session("A"));
    await graph.invoke(ask("Qual é a minha empresa?"), session("A"));
    await graph.invoke(ask("Qual é a minha empresa?"), session("B"));

    // Session A, 2nd turn: the model saw the 1st turn (context kept).
    expect(texts(model.calls[1].messages)).toContain("Sou da Padaria Pão Dourado.");
    // Session B: the model saw only the system prompt and B's own message.
    expect(model.calls[2].messages).toHaveLength(2);
    expect(texts(model.calls[2].messages)).not.toContain("Sou da Padaria Pão Dourado.");

    const stateA = await graph.getState(session("A"));
    const stateB = await graph.getState(session("B"));
    expect(stateA.values.messages).toHaveLength(4);
    expect(stateB.values.messages).toHaveLength(2);
  });
});
