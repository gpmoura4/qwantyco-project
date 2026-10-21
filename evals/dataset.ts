import type { Decision } from "@/agent/domain/schemas";

// Evaluation dataset (R16). Each case is a short conversation in a fresh runtime.
// `decisao` is what the target answers, playing the human, if the graph pauses
// for approval; without it, an unexpected proposal is rejected (nothing registered).

export const DATASET_NAME = "aurora-suporte";

export type CaseInputs = {
  messages: string[];
  decisao?: Decision["decisao"];
};

export type CaseReference =
  // Mandatory case (PDF): list the open tickets from the real tool result.
  | { kind: "list_open"; expected_ids: string[] }
  // Additional case (P10, D38): after an approved escalation, the status answer
  // must agree with the `escalonamento` field of the latest tool result.
  | { kind: "status_after_approval"; chamado_id: string };

export type EvalCase = { inputs: CaseInputs; reference: CaseReference };

export const CASES: EvalCase[] = [
  {
    inputs: { messages: ["Liste todos os chamados abertos."] },
    reference: { kind: "list_open", expected_ids: ["CH-101", "CH-103"] },
  },
  {
    inputs: {
      messages: [
        "Consulte o CH-101 e prepare um escalonamento se ele estiver aberto.",
        "O CH-101 já foi escalonado?",
      ],
      decisao: "aprovar",
    },
    reference: { kind: "status_after_approval", chamado_id: "CH-101" },
  },
];
