import { randomUUID } from "node:crypto";
import { AIMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Faults } from "@/agent/faults";
import type { Limits } from "@/agent/run";
import { createRuntime, setRuntimeForTests, type AgentRuntime } from "@/agent/runtime";
import { POST as postDecision } from "@/app/api/chat/decision/route";
import { POST as postMessage } from "@/app/api/chat/route";

// API tests: the Next.js route handlers are plain functions (Request → Response),
// called directly with a runtime that uses a fake model. No server, no network.

const FAST: Limits = {
  toolTimeoutMs: 50,
  toolMaxAttempts: 3,
  modelTimeoutMs: 1_000,
  modelMaxAttempts: 2,
  retryIntervalMs: 1,
  maxSteps: 12,
  maxActiveMs: 2_000,
};

let model: ReturnType<typeof fakeModel>;
let runtime: AgentRuntime;

function useRuntime(faults: Faults = {}) {
  model = fakeModel();
  runtime = createRuntime({ model, faults, limits: FAST });
  setRuntimeForTests(runtime);
}

beforeEach(() => useRuntime());
afterEach(() => setRuntimeForTests(undefined));

async function call(handler: (request: Request) => Promise<Response>, body: unknown) {
  const response = await handler(
    new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
  return { status: response.status, body: await response.json() };
}

const ESCALATION = {
  name: "register_escalation",
  args: { chamado_id: "CH-101", resumo: "Erro 500 ao emitir NF.", justificativa: "Cliente parado." },
};

// Session asks to escalate CH-101; returns the proposal shown to the human.
async function proposeIn(sessionId: string) {
  model.respondWithTools([ESCALATION]);
  const res = await call(postMessage, { sessionId, message: "Escalone o CH-101." });
  expect(res.body.kind).toBe("approval_required");
  return res.body.proposal as { id: string };
}

describe("POST /api/chat", () => {
  it("answers a query using the real tool result", async () => {
    model
      .respondWithTools([{ name: "listar_chamados", args: { situacao: "aberto" } }])
      .respond(new AIMessage("Chamados abertos: CH-101 e CH-103."));

    const res = await call(postMessage, { sessionId: randomUUID(), message: "Liste os abertos." });

    expect(res).toEqual({
      status: 200,
      body: { kind: "reply", reply: "Chamados abertos: CH-101 e CH-103." },
    });
  });

  it("returns the exact proposal when an escalation needs approval", async () => {
    model.respondWithTools([ESCALATION]);

    const res = await call(postMessage, { sessionId: randomUUID(), message: "Escalone o CH-101." });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ kind: "approval_required", proposal: ESCALATION.args });
    expect(runtime.escalationStore.list()).toHaveLength(0);
  });

  it("refuses a new message while a proposal is pending (409)", async () => {
    const sessionId = randomUUID();
    await proposeIn(sessionId);

    const res = await call(postMessage, { sessionId, message: "E o CH-103?" });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("PROPOSAL_PENDING");
  });

  it.each([
    ["missing sessionId", { message: "Oi" }],
    ["sessionId is not a UUID", { sessionId: "abc", message: "Oi" }],
    ["empty message", { sessionId: randomUUID(), message: "   " }],
    ["body is not JSON", "{not json"],
  ])("rejects an invalid body with 400 (%s)", async (_case, body) => {
    const res = await call(postMessage, body);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_REQUEST");
    expect(model.callCount).toBe(0);
  });

  it("returns 503 with a controlled error when the tool keeps failing", async () => {
    useRuntime({ listar_chamados: { mode: "error", times: 3 } });
    model.respondWithTools([{ name: "listar_chamados", args: { situacao: "aberto" } }]);

    const res = await call(postMessage, { sessionId: randomUUID(), message: "Liste os abertos." });

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("EXECUTION_FAILED");
  });
});

describe("POST /api/chat/decision", () => {
  it("approving registers the proposal; approving again does not duplicate", async () => {
    const sessionId = randomUUID();
    const proposal = await proposeIn(sessionId);
    const decision = { sessionId, proposta_id: proposal.id, decisao: "aprovar" };

    const first = await call(postDecision, decision);
    const second = await call(postDecision, decision);

    expect(first).toEqual({
      status: 200,
      body: { kind: "reply", reply: "Escalonamento ESC-001 registrado para o chamado CH-101." },
    });
    expect(second).toEqual({
      status: 200,
      body: { kind: "reply", reply: "Escalonamento ESC-001 já registrado para o chamado CH-101." },
    });
    expect(runtime.escalationStore.list()).toHaveLength(1);
  });

  it("rejecting writes nothing and unblocks the session", async () => {
    const sessionId = randomUUID();
    const proposal = await proposeIn(sessionId);

    const res = await call(postDecision, { sessionId, proposta_id: proposal.id, decisao: "rejeitar" });
    model.respond(new AIMessage("Certo, algo mais?"));
    const next = await call(postMessage, { sessionId, message: "Ok." });

    expect(res.body.reply).toBe("Escalonamento rejeitado. Nada foi registrado.");
    expect(runtime.escalationStore.list()).toHaveLength(0);
    expect(next.status).toBe(200);
  });

  it("refuses a decision for a different proposal (409)", async () => {
    const sessionId = randomUUID();
    await proposeIn(sessionId);

    const res = await call(postDecision, { sessionId, proposta_id: "prop-outra", decisao: "aprovar" });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("PROPOSAL_MISMATCH");
  });

  it("rejects an invalid decision value with 400", async () => {
    const res = await call(postDecision, {
      sessionId: randomUUID(),
      proposta_id: "prop-1",
      decisao: "talvez",
    });

    expect(res.status).toBe(400);
  });
});

describe("Sessions are isolated", () => {
  it("session B cannot approve session A's proposal", async () => {
    const sessionA = randomUUID();
    const sessionB = randomUUID();
    const proposal = await proposeIn(sessionA);

    const res = await call(postDecision, {
      sessionId: sessionB,
      proposta_id: proposal.id,
      decisao: "aprovar",
    });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("NO_PENDING_PROPOSAL");
    expect(runtime.escalationStore.list()).toHaveLength(0);
  });

  it("a pending proposal in session A does not block session B", async () => {
    await proposeIn(randomUUID());
    model.respond(new AIMessage("Olá!"));

    const res = await call(postMessage, { sessionId: randomUUID(), message: "Oi" });

    expect(res).toEqual({ status: 200, body: { kind: "reply", reply: "Olá!" } });
  });
});
