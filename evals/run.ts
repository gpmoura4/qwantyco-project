// LangSmith evaluation (R16–R19). Not part of `npm test`.
//   npm run eval        experiment with the real model (Ollama), REPETITIONS per case
//   npm run eval:demo   evaluator demonstrations with fabricated answers (no model)
import { awaitAllCallbacks } from "@langchain/core/callbacks/promises";
import { Client } from "langsmith";
import { evaluate } from "langsmith/evaluation";
import type { Example } from "langsmith/schemas";
import { createChatModel } from "@/agent/model";
import { DEFAULT_LIMITS } from "@/agent/run";
import { DATASET_NAME, type CaseInputs, type CaseReference } from "./dataset";
import { DEMOS } from "./demo";
import { evaluateCase } from "./evaluators";
import { syncDataset } from "./sync";
import { runCase, type CaseOutputs } from "./target";

// Each case runs this many times, to measure how stable the small model is (D49).
const REPETITIONS = 3;

// The SDK hands outputs and reference as plain records; the evaluator is typed.
const evaluator = ({
  outputs,
  referenceOutputs,
}: {
  outputs: Record<string, unknown>;
  referenceOutputs?: Record<string, unknown>;
}) =>
  evaluateCase({
    outputs: outputs as CaseOutputs,
    referenceOutputs: referenceOutputs as CaseReference,
  });

async function runReal(client: Client) {
  // Fails early if OLLAMA_MODEL is missing.
  createChatModel();
  const model = process.env.OLLAMA_MODEL!;

  // Named function: LangSmith uses it as the run name (anonymous ones show "<lambda>").
  const auroraCase = (inputs: CaseInputs) => runCase(createChatModel(), inputs);
  const results = await evaluate(auroraCase, {
    data: DATASET_NAME,
    evaluators: [evaluator],
    client,
    experimentPrefix: `aurora-${model}`,
    description: `Agente Aurora com ${model} (Ollama local, temperature 0), ${REPETITIONS} repetições por caso.`,
    numRepetitions: REPETITIONS,
    // One case at a time: the local model serves one request at a time.
    maxConcurrency: 1,
    // LangSmith adds the git commit (and whether it is dirty) on its own.
    metadata: {
      provider: "ollama",
      model,
      temperature: 0,
      repetitions: REPETITIONS,
      limits: DEFAULT_LIMITS,
    },
  });
  report(results.experimentName, results.results);
}

async function runDemos(client: Client) {
  const examples: Example[] = [];
  for await (const example of client.listExamples({ datasetName: DATASET_NAME })) {
    if ((example.outputs as CaseReference | undefined)?.kind === "list_open") examples.push(example);
  }
  for (const demo of DEMOS) {
    const demoCase = (inputs: CaseInputs) => demo.target(inputs);
    const results = await evaluate(demoCase, {
      data: examples,
      evaluators: [evaluator],
      client,
      experimentPrefix: demo.name,
      description: demo.description,
      metadata: { demo: true },
    });
    report(results.experimentName, results.results);
  }
}

// Console summary: one line per run with the evaluator scores.
function report(
  experiment: string,
  rows: { example: Example; evaluationResults: { results: { key: string; score?: unknown }[] } }[],
) {
  console.log(`\nExperimento: ${experiment}`);
  for (const row of rows) {
    const kind = (row.example.outputs as CaseReference | undefined)?.kind ?? "?";
    const scores = row.evaluationResults.results.map((r) => `${r.key}=${r.score}`).join(" ");
    console.log(`  ${kind}: ${scores}`);
  }
}

async function main() {
  if (!process.env.LANGSMITH_API_KEY) {
    throw new Error("LANGSMITH_API_KEY is not set (see .env.example).");
  }
  const client = new Client();
  const sync = await syncDataset(client);
  console.log(
    `Dataset ${DATASET_NAME}: ${sync.created} example(s) criado(s), ${sync.deleted} removido(s).`,
  );

  if (process.argv.includes("--demo")) await runDemos(client);
  else await runReal(client);

  await client.awaitPendingTraceBatches();
}

// Waits for the LangSmith traces to be sent before the process exits.
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => awaitAllCallbacks());
