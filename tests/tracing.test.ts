import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { RunCollectorCallbackHandler } from "@langchain/core/tracers/run_collector";
import { MemorySaver } from "@langchain/langgraph";
import { describe, expect, it } from "vitest";
import { decideProposal, getPendingProposal } from "@/agent/approval";
import { createEscalationStore } from "@/agent/domain/escalations";
import { buildGraph } from "@/agent/graph";
import { runAgent } from "@/agent/run";

// What LangSmith receives (R15), checked offline: an in-memory collector gets the
// same run tree the LangSmith tracer would send. Nothing leaves the process.

function setup() {
  const model = fakeModel();
  const escalationStore = createEscalationStore();
  const collector = new RunCollectorCallbackHandler();
  const graph = buildGraph({ model, checkpointer: new MemorySaver(), escalationStore }).withConfig({
    callbacks: [collector],
  });
  return { model, escalationStore, graph, collector };
}

const ask = (text: string) => ({ messages: [new HumanMessage(text)] });

// The fields read here; child runs are typed by the langsmith package.
type TracedRun = {
  name: string;
  run_type: string;
  inputs: unknown;
  outputs?: unknown;
  child_runs?: TracedRun[];
};

// The run and all of its descendants.
const flatten = (run: TracedRun): TracedRun[] => [
  run,
  ...(run.child_runs ?? []).flatMap(flatten),
];

describe("Trace identity of each invocation (D43)", () => {
  it("a user message is a root run named aurora_message, tagged and tied to the session", async () => {
    const ctx = setup();
    ctx.model.respond(new AIMessage("Olá!"));

    await runAgent(ctx.graph, ask("Oi"), "s1");

    const [root] = ctx.collector.tracedRuns;
    expect(root.name).toBe("aurora_message");
    expect(root.tags).toEqual(expect.arrayContaining(["aurora", "message"]));
    expect(root.extra?.metadata).toMatchObject({ run_kind: "message", thread_id: "s1" });
  });

  it("the resume after approval is a root run named aurora_resume, with the proposal id", async () => {
    const ctx = setup();
    ctx.model.respondWithTools([
      {
        name: "register_escalation",
        args: { chamado_id: "CH-101", resumo: "Erro 500.", justificativa: "Cliente parado." },
      },
    ]);
    await runAgent(ctx.graph, ask("Escalone o CH-101."), "s1");
    const proposal = (await getPendingProposal(ctx.graph, "s1"))!;

    await decideProposal({
      ...ctx,
      threadId: "s1",
      decision: { proposta_id: proposal.id, decisao: "aprovar" },
    });

    const [message, resume] = ctx.collector.tracedRuns;
    expect(message.name).toBe("aurora_message");
    expect(resume.name).toBe("aurora_resume");
    expect(resume.tags).toEqual(expect.arrayContaining(["aurora", "resume"]));
    // Same thread_id as the message: LangSmith shows both in the same thread.
    expect(resume.extra?.metadata).toMatchObject({
      run_kind: "resume",
      proposta_id: proposal.id,
      thread_id: "s1",
    });
  });
});

describe("Run tree of an invocation", () => {
  it("nests the nodes, the model call and the tool run with its args and result", async () => {
    const ctx = setup();
    ctx.model
      .respondWithTools([{ name: "listar_chamados", args: { situacao: "aberto" } }])
      .respond(new AIMessage("CH-101 e CH-103."));

    await runAgent(ctx.graph, ask("Liste os abertos."), "s1");

    const runs = flatten(ctx.collector.tracedRuns[0]);
    const names = runs.map((run) => run.name);
    expect(names).toEqual(expect.arrayContaining(["callModel", "executeTools", "checkReply"]));
    expect(runs.some((run) => run.run_type === "llm")).toBe(true);

    // The tool run sits under executeTools, so it belongs to the same trace.
    const executeTools = runs.find((run) => run.name === "executeTools")!;
    const tool = flatten(executeTools).find((run) => run.run_type === "tool")!;
    expect(tool.name).toBe("listar_chamados");
    expect(JSON.stringify(tool.inputs)).toContain("aberto");
    expect(JSON.stringify(tool.outputs)).toContain("CH-101");
  });
});

describe("Tests never send traces (D44)", () => {
  it("every variable that turns tracing on is off", () => {
    for (const name of [
      "LANGSMITH_TRACING",
      "LANGSMITH_TRACING_V2",
      "LANGCHAIN_TRACING",
      "LANGCHAIN_TRACING_V2",
    ]) {
      expect(process.env[name], name).toBe("false");
    }
  });
});
