import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { Command, MemorySaver } from "@langchain/langgraph";
import { describe, expect, it } from "vitest";
import { decideProposal, getPendingProposal } from "@/agent/approval";
import { createEscalationStore } from "@/agent/domain/escalations";
import { buildGraph } from "@/agent/graph";

// Offline tests of the human approval flow (interrupt + resume), with a scripted
// fake model going through the real graph, executor and domain guards.

const session = (threadId: string) => ({ configurable: { thread_id: threadId } });

const ask = (text: string) => ({ messages: [new HumanMessage(text)] });

const toolResult = (message: BaseMessage) => JSON.parse(message.content as string);

const ESCALATION_ARGS = {
  chamado_id: "CH-101",
  resumo: "Erro 500 ao emitir nota fiscal desde ontem.",
  justificativa: "Cliente impedido de faturar.",
};

function setup() {
  const model = fakeModel();
  const escalationStore = createEscalationStore();
  const graph = buildGraph({ model, checkpointer: new MemorySaver(), escalationStore });
  return { model, escalationStore, graph };
}

// Session `threadId` asks to escalate; the model proposes `args`; the graph pauses.
async function propose(
  { model, graph }: ReturnType<typeof setup>,
  threadId: string,
  args = ESCALATION_ARGS,
) {
  model.respondWithTools([{ name: "register_escalation", args, id: `call-${threadId}` }]);
  await graph.invoke(ask(`Escalone o ${args.chamado_id}.`), session(threadId));
  return getPendingProposal(graph, threadId);
}

describe("T02 — resolved ticket cannot be escalated", () => {
  it("blocks CH-102 before reaching the human: no proposal, no interrupt", async () => {
    const ctx = setup();
    ctx.model
      .respondWithTools([
        { name: "register_escalation", args: { ...ESCALATION_ARGS, chamado_id: "CH-102" } },
      ])
      .respond(new AIMessage("O CH-102 está resolvido e não pode ser escalonado."));

    await ctx.graph.invoke(ask("Escalone o CH-102."), session("s1"));

    expect(await getPendingProposal(ctx.graph, "s1")).toBeNull();
    const state = await ctx.graph.getState(session("s1"));
    const toolMessage = state.values.messages.find(ToolMessage.isInstance)!;
    expect(toolResult(toolMessage)).toMatchObject({ ok: false, error: { code: "TICKET_NOT_OPEN" } });
    expect(ctx.escalationStore.list()).toHaveLength(0);
  });

  it("cannot be forced through the backend: there is no proposal to approve", async () => {
    const ctx = setup();
    const result = await decideProposal({
      ...ctx,
      threadId: "s1",
      decision: { proposta_id: "prop-forjada", decisao: "aprovar" },
    });

    expect(result).toMatchObject({ ok: false, error: { code: "NO_PENDING_PROPOSAL" } });
    expect(ctx.escalationStore.list()).toHaveLength(0);
  });
});

describe("T03 — approval and rejection", () => {
  it("pauses with the exact proposal and writes nothing while waiting", async () => {
    const ctx = setup();

    const pending = await propose(ctx, "s1");

    expect(pending).toMatchObject(ESCALATION_ARGS);
    expect(pending?.id).toMatch(/^prop-/);
    expect(ctx.escalationStore.list()).toHaveLength(0);
  });

  it("approving registers exactly the proposal that was shown", async () => {
    const ctx = setup();
    const pending = (await propose(ctx, "s1"))!;

    const result = await decideProposal({
      ...ctx,
      threadId: "s1",
      decision: { proposta_id: pending.id, decisao: "aprovar" },
    });

    expect(result).toEqual({
      ok: true,
      data: { reply: "Escalonamento ESC-001 registrado para o chamado CH-101." },
    });
    expect(ctx.escalationStore.list()).toEqual([
      { id: "ESC-001", proposta_id: pending.id, ...ESCALATION_ARGS },
    ]);
    // The confirmation came from the real result, not from the model (A3).
    expect(ctx.model.callCount).toBe(1);
    expect(await getPendingProposal(ctx.graph, "s1")).toBeNull();
  });

  it("rejecting ends the flow without writing anything", async () => {
    const ctx = setup();
    const pending = (await propose(ctx, "s1"))!;

    const result = await decideProposal({
      ...ctx,
      threadId: "s1",
      decision: { proposta_id: pending.id, decisao: "rejeitar" },
    });

    expect(result).toEqual({
      ok: true,
      data: { reply: "Escalonamento rejeitado. Nada foi registrado." },
    });
    expect(ctx.escalationStore.list()).toHaveLength(0);
    expect(await getPendingProposal(ctx.graph, "s1")).toBeNull();
  });

  it("keeps the conversation going after a decision", async () => {
    const ctx = setup();
    const pending = (await propose(ctx, "s1"))!;
    await decideProposal({
      ...ctx,
      threadId: "s1",
      decision: { proposta_id: pending.id, decisao: "aprovar" },
    });

    ctx.model.respond(new AIMessage("Posso ajudar em algo mais?"));
    await ctx.graph.invoke(ask("Obrigado!"), session("s1"));

    // The model saw the registration result in the history.
    const seen = ctx.model.calls[1].messages.map((m) => m.content);
    expect(seen).toContain("Escalonamento ESC-001 registrado para o chamado CH-101.");
  });
});

describe("Read tools expose the escalation (source of truth, D38)", () => {
  const lastToolResult = async (ctx: ReturnType<typeof setup>, threadId: string) => {
    const state = await ctx.graph.getState(session(threadId));
    return toolResult(state.values.messages.filter(ToolMessage.isInstance).at(-1)!);
  };

  it("get_ticket reports escalonamento: null before and ESC-001 after approval", async () => {
    const ctx = setup();
    ctx.model
      .respondWithTools([{ name: "get_ticket", args: { chamado_id: "CH-101" } }])
      .respond(new AIMessage("O CH-101 não foi escalonado."));
    await ctx.graph.invoke(ask("O CH-101 foi escalonado?"), session("before"));
    expect(await lastToolResult(ctx, "before")).toMatchObject({
      ok: true,
      data: { id: "CH-101", situacao: "aberto", escalonamento: null },
    });

    const pending = (await propose(ctx, "s1"))!;
    await decideProposal({
      ...ctx,
      threadId: "s1",
      decision: { proposta_id: pending.id, decisao: "aprovar" },
    });

    ctx.model
      .respondWithTools([{ name: "get_ticket", args: { chamado_id: "CH-101" } }])
      .respond(new AIMessage("O CH-101 foi escalonado (ESC-001)."));
    await ctx.graph.invoke(ask("O CH-101 foi escalonado?"), session("after"));
    // The ticket is unchanged (D19); the view joins it with its escalation.
    expect(await lastToolResult(ctx, "after")).toMatchObject({
      ok: true,
      data: {
        id: "CH-101",
        situacao: "aberto",
        escalonamento: { id: "ESC-001", resumo: ESCALATION_ARGS.resumo },
      },
    });
  });

  it("after approval, the newest tool result about the ticket shows the escalation", async () => {
    const ctx = setup();
    const pending = (await propose(ctx, "s1"))!;
    await decideProposal({
      ...ctx,
      threadId: "s1",
      decision: { proposta_id: pending.id, decisao: "aprovar" },
    });

    // Same shape as get_ticket, so an older "escalonamento": null in the history
    // is superseded by true data (the model read the stale null before this fix).
    expect(await lastToolResult(ctx, "s1")).toMatchObject({
      ok: true,
      data: { id: "CH-101", situacao: "aberto", escalonamento: { id: "ESC-001" } },
    });
  });

  it("listar_chamados keeps returning exactly CH-101 and CH-103 as open", async () => {
    const ctx = setup();
    const pending = (await propose(ctx, "s1"))!;
    await decideProposal({
      ...ctx,
      threadId: "s1",
      decision: { proposta_id: pending.id, decisao: "aprovar" },
    });

    ctx.model
      .respondWithTools([{ name: "listar_chamados", args: { situacao: "aberto" } }])
      .respond(new AIMessage("CH-101 e CH-103."));
    await ctx.graph.invoke(ask("Liste os abertos."), session("list"));

    const { data } = await lastToolResult(ctx, "list");
    expect(data.map((t: { id: string }) => t.id)).toEqual(["CH-101", "CH-103"]);
    expect(data.map((t: { escalonamento: { id: string } | null }) => t.escalonamento?.id ?? null))
      .toEqual(["ESC-001", null]);
  });
});

describe("T04 — repeated approval creates a single record", () => {
  it("approving the same proposal twice returns the same ESC-001", async () => {
    const ctx = setup();
    const pending = (await propose(ctx, "s1"))!;
    const decision = { proposta_id: pending.id, decisao: "aprovar" as const };

    await decideProposal({ ...ctx, threadId: "s1", decision });
    const second = await decideProposal({ ...ctx, threadId: "s1", decision });

    expect(second).toEqual({
      ok: true,
      data: { reply: "Escalonamento ESC-001 já registrado para o chamado CH-101." },
    });
    expect(ctx.escalationStore.list()).toHaveLength(1);
  });

  it("two sessions proposing the same ticket: only the first approval registers", async () => {
    const ctx = setup();
    const proposalA = (await propose(ctx, "A"))!;
    const proposalB = (await propose(ctx, "B"))!;

    await decideProposal({
      ...ctx,
      threadId: "A",
      decision: { proposta_id: proposalA.id, decisao: "aprovar" },
    });
    const resultB = await decideProposal({
      ...ctx,
      threadId: "B",
      decision: { proposta_id: proposalB.id, decisao: "aprovar" },
    });

    // Guards run again at registration time (CH-101 was escalated meanwhile).
    expect(resultB).toMatchObject({
      ok: true,
      data: { reply: expect.stringContaining("já foi escalonado (ESC-001)") },
    });
    expect(ctx.escalationStore.list()).toHaveLength(1);
  });
});

describe("Approval is validated in the backend and tied to the proposal", () => {
  it("rejects a decision for a different proposal without resuming the graph", async () => {
    const ctx = setup();
    await propose(ctx, "s1");

    const result = await decideProposal({
      ...ctx,
      threadId: "s1",
      decision: { proposta_id: "prop-outra", decisao: "aprovar" },
    });

    expect(result).toMatchObject({ ok: false, error: { code: "PROPOSAL_MISMATCH" } });
    expect(await getPendingProposal(ctx.graph, "s1")).not.toBeNull();
    expect(ctx.escalationStore.list()).toHaveLength(0);
  });

  it("a session cannot approve another session's proposal", async () => {
    const ctx = setup();
    const proposalA = (await propose(ctx, "A"))!;

    const result = await decideProposal({
      ...ctx,
      threadId: "B",
      decision: { proposta_id: proposalA.id, decisao: "aprovar" },
    });

    expect(result).toMatchObject({ ok: false, error: { code: "NO_PENDING_PROPOSAL" } });
    expect(ctx.escalationStore.list()).toHaveLength(0);
  });

  it("even resuming the graph directly with a wrong proposal id registers nothing", async () => {
    const ctx = setup();
    await propose(ctx, "s1");

    const state = await ctx.graph.invoke(
      new Command({ resume: { proposta_id: "prop-outra", decisao: "aprovar" } }),
      session("s1"),
    );

    expect(state.messages.at(-1)?.content).toContain("não corresponde à proposta pendente");
    expect(ctx.escalationStore.list()).toHaveLength(0);
  });

  it("a malformed resume value is refused by the Zod responseSchema", async () => {
    const ctx = setup();
    await propose(ctx, "s1");

    await expect(
      ctx.graph.invoke(new Command({ resume: { ok: "sim" } }), session("s1")),
    ).rejects.toThrow();
    expect(ctx.escalationStore.list()).toHaveLength(0);
    expect(await getPendingProposal(ctx.graph, "s1")).not.toBeNull();
  });
});
