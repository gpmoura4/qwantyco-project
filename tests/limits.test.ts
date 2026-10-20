import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { MemorySaver } from "@langchain/langgraph";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { decideProposal, getPendingProposal } from "@/agent/approval";
import { createEscalationStore } from "@/agent/domain/escalations";
import { parseFaults, type Faults } from "@/agent/faults";
import { buildGraph } from "@/agent/graph";
import { runAgent, type Limits } from "@/agent/run";

// Offline tests of failures and limits (T05, T06). Small limits keep them fast;
// faults are deterministic (fail the first N attempts of each tool call).

const FAST: Limits = {
  toolTimeoutMs: 50,
  toolMaxAttempts: 3,
  modelTimeoutMs: 1_000,
  modelMaxAttempts: 2,
  retryIntervalMs: 1,
  maxSteps: 12,
  maxActiveMs: 2_000,
};

function setup({ faults = {}, limits = FAST }: { faults?: Faults; limits?: Limits } = {}) {
  const model = fakeModel();
  const escalationStore = createEscalationStore();
  const graph = buildGraph({
    model,
    checkpointer: new MemorySaver(),
    escalationStore,
    faults,
    limits,
  });
  return { model, escalationStore, graph, limits };
}

const ask = (text: string) => ({ messages: [new HumanMessage(text)] });

const toolMessages = (messages: BaseMessage[]) => messages.filter(ToolMessage.isInstance);

const toolResult = (message: BaseMessage) => JSON.parse(message.content as string);

const listOpen = { name: "listar_chamados", args: { situacao: "aberto" } };

describe("T05 — transient failure recovered within the retry limit", () => {
  it("recovers when the tool fails twice and works on the 3rd attempt", async () => {
    const ctx = setup({ faults: { listar_chamados: { mode: "error", times: 2 } } });
    ctx.model.respondWithTools([listOpen]).respond(new AIMessage("CH-101 e CH-103."));

    const run = await runAgent(ctx.graph, ask("Liste os abertos."), "s1", ctx.limits);

    expect(run.ok).toBe(true);
    const [toolMessage] = toolMessages(run.ok ? run.data.messages : []);
    expect(toolResult(toolMessage).data.map((t: { id: string }) => t.id)).toEqual([
      "CH-101",
      "CH-103",
    ]);
    // Retries re-ran the tool, not the model.
    expect(ctx.model.callCount).toBe(2);
  });

  it("recovers when the first attempt times out", async () => {
    const ctx = setup({ faults: { listar_chamados: { mode: "timeout", times: 1 } } });
    ctx.model.respondWithTools([listOpen]).respond(new AIMessage("CH-101 e CH-103."));

    const run = await runAgent(ctx.graph, ask("Liste os abertos."), "s1", ctx.limits);

    expect(run).toMatchObject({ ok: true });
  });

  it("recovers when the model call fails once", async () => {
    const ctx = setup();
    ctx.model.respond(new Error("Ollama indisponível")).respond(new AIMessage("Olá!"));

    const run = await runAgent(ctx.graph, ask("Oi"), "s1", ctx.limits);

    expect(run.ok && run.data.messages.at(-1)?.content).toBe("Olá!");
    expect(ctx.model.callCount).toBe(2);
  });
});

describe("T06 — limits end with a controlled error, nothing invented", () => {
  it("returns EXECUTION_FAILED when every attempt fails (retry limit)", async () => {
    const ctx = setup({ faults: { listar_chamados: { mode: "error", times: 3 } } });
    ctx.model.respondWithTools([listOpen]).respond(new AIMessage("Nunca deveria aparecer."));

    const run = await runAgent(ctx.graph, ask("Liste os abertos."), "s1", ctx.limits);

    expect(run).toMatchObject({
      ok: false,
      error: { code: "EXECUTION_FAILED", message: expect.stringContaining("Nenhuma operação") },
    });
    // The model never got a chance to answer without the tool result.
    expect(ctx.model.callCount).toBe(1);
  });

  it("returns EXECUTION_FAILED when every attempt times out", async () => {
    const ctx = setup({ faults: { listar_chamados: { mode: "timeout", times: 3 } } });
    ctx.model.respondWithTools([listOpen]);

    const run = await runAgent(ctx.graph, ask("Liste os abertos."), "s1", ctx.limits);

    expect(run).toMatchObject({ ok: false, error: { code: "EXECUTION_FAILED" } });
  });

  it("stops a model/tool loop at the step limit", async () => {
    const ctx = setup({ limits: { ...FAST, maxSteps: 6 } });
    for (let i = 0; i < 10; i++) {
      ctx.model.respondWithTools([{ name: "get_ticket", args: { chamado_id: "CH-101" } }]);
    }

    const run = await runAgent(ctx.graph, ask("Consulte o CH-101."), "s1", ctx.limits);

    expect(run).toMatchObject({
      ok: false,
      error: { code: "EXECUTION_LIMIT", message: expect.stringContaining("passos") },
    });
  });

  it("stops at the active time budget", async () => {
    const ctx = setup({
      faults: { listar_chamados: { mode: "timeout", times: 1 } },
      limits: { ...FAST, toolTimeoutMs: 10_000, maxActiveMs: 100 },
    });
    ctx.model.respondWithTools([listOpen]);

    const run = await runAgent(ctx.graph, ask("Liste os abertos."), "s1", ctx.limits);

    expect(run).toMatchObject({
      ok: false,
      error: { code: "EXECUTION_LIMIT", message: expect.stringContaining("tempo") },
    });
  });

  it("discards an invalid tool output instead of passing it to the model", async () => {
    const ctx = setup({ faults: { get_ticket: { mode: "invalid_output", times: 1 } } });
    ctx.model
      .respondWithTools([{ name: "get_ticket", args: { chamado_id: "CH-101" } }])
      .respond(new AIMessage("Não consegui consultar o chamado."));

    const run = await runAgent(ctx.graph, ask("Consulte o CH-101."), "s1", ctx.limits);

    const [toolMessage] = toolMessages(run.ok ? run.data.messages : []);
    expect(toolResult(toolMessage)).toMatchObject({
      ok: false,
      error: { code: "INVALID_OUTPUT" },
    });
    expect(String(toolMessage.content)).not.toContain("corrupted");
  });

  it("answers a malformed tool call from the model with INVALID_ARGS", async () => {
    const ctx = setup();
    ctx.model
      .respond(
        new AIMessage({
          content: "",
          invalid_tool_calls: [
            {
              type: "invalid_tool_call",
              id: "bad-1",
              name: "get_ticket",
              args: '{"chamado_id": "CH-101"',
              error: "JSON inválido",
            },
          ],
        }),
      )
      .respond(new AIMessage("Desculpe, houve um erro na consulta."));

    const run = await runAgent(ctx.graph, ask("Consulte o CH-101."), "s1", ctx.limits);

    const [toolMessage] = toolMessages(run.ok ? run.data.messages : []);
    expect(toolMessage.tool_call_id).toBe("bad-1");
    expect(toolResult(toolMessage)).toMatchObject({ ok: false, error: { code: "INVALID_ARGS" } });
  });
});

describe("After a controlled error", () => {
  it("the same session keeps working on the next message", async () => {
    const ctx = setup({ faults: { listar_chamados: { mode: "error", times: 3 } } });
    ctx.model.respondWithTools([listOpen]);
    const failed = await runAgent(ctx.graph, ask("Liste os abertos."), "s1", ctx.limits);
    expect(failed).toMatchObject({ ok: false, error: { code: "EXECUTION_FAILED" } });

    ctx.model.respond(new AIMessage("Olá de novo!"));
    const next = await runAgent(ctx.graph, ask("Oi"), "s1", ctx.limits);

    expect(next.ok && next.data.messages.at(-1)?.content).toBe("Olá de novo!");
  });
});

describe("Human waiting time does not count toward the active budget", () => {
  it("approves after waiting longer than the whole budget", async () => {
    const ctx = setup({ limits: { ...FAST, maxActiveMs: 300 } });
    ctx.model.respondWithTools([
      {
        name: "register_escalation",
        args: { chamado_id: "CH-101", resumo: "Erro 500.", justificativa: "Cliente parado." },
      },
    ]);

    const first = await runAgent(ctx.graph, ask("Escalone o CH-101."), "s1", ctx.limits);
    expect(first.ok).toBe(true);
    const proposal = (await getPendingProposal(ctx.graph, "s1"))!;

    await sleep(500); // the human takes longer than maxActiveMs

    const decision = await decideProposal({
      ...ctx,
      threadId: "s1",
      decision: { proposta_id: proposal.id, decisao: "aprovar" },
    });
    expect(decision).toMatchObject({ ok: true });
    expect(ctx.escalationStore.list()).toHaveLength(1);
  });
});

describe("parseFaults (SIMULATE_TOOL_FAILURE)", () => {
  it("parses tool:mode:times entries", () => {
    expect(parseFaults("listar_chamados:error:2, get_ticket:timeout:1")).toEqual({
      listar_chamados: { mode: "error", times: 2 },
      get_ticket: { mode: "timeout", times: 1 },
    });
    expect(parseFaults(undefined)).toEqual({});
  });

  it("rejects malformed entries instead of ignoring them", () => {
    expect(() => parseFaults("listar_chamados:explode:2")).toThrow();
    expect(() => parseFaults("listar_chamados:error:0")).toThrow();
  });
});
