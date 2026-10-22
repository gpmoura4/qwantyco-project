import type { Client } from "langsmith";
import { CASES, DATASET_NAME, type EvalCase } from "./dataset";

// Keeps the LangSmith copy of the dataset equal to CASES (D48): the code is the
// only place where cases are edited. A sync that changes something creates a new
// dataset version, and old experiments keep pointing to the version they used.

type ExistingExample = { id: string; inputs: unknown; outputs?: unknown };

// Same content, same key, whatever key order the API returns.
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const exampleKey = (inputs: unknown, outputs: unknown) => stableJson({ inputs, outputs });

// What to create and delete so the examples match the cases (inputs + reference).
// A changed case is a delete plus a create; duplicated examples are deleted.
export function planSync(
  cases: EvalCase[],
  existing: ExistingExample[],
): { toCreate: EvalCase[]; toDelete: string[] } {
  const wanted = new Set(cases.map((c) => exampleKey(c.inputs, c.reference)));
  const kept = new Set<string>();
  const toDelete: string[] = [];
  for (const example of existing) {
    const key = exampleKey(example.inputs, example.outputs);
    if (wanted.has(key) && !kept.has(key)) kept.add(key);
    else toDelete.push(example.id);
  }
  const toCreate = cases.filter((c) => !kept.has(exampleKey(c.inputs, c.reference)));
  return { toCreate, toDelete };
}

export async function syncDataset(client: Client): Promise<{ created: number; deleted: number }> {
  const dataset = (await client.hasDataset({ datasetName: DATASET_NAME }))
    ? await client.readDataset({ datasetName: DATASET_NAME })
    : await client.createDataset(DATASET_NAME, {
        description: "Aurora: caso obrigatório do desafio e caso adicional (status após aprovação).",
      });

  const existing: ExistingExample[] = [];
  for await (const example of client.listExamples({ datasetId: dataset.id })) existing.push(example);

  const { toCreate, toDelete } = planSync(CASES, existing);
  if (toDelete.length > 0) await client.deleteExamples(toDelete);
  if (toCreate.length > 0) {
    await client.createExamples(
      toCreate.map((c) => ({ inputs: c.inputs, outputs: c.reference, dataset_id: dataset.id })),
    );
  }
  return { created: toCreate.length, deleted: toDelete.length };
}
