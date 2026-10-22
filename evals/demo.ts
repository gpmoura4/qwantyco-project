import { createEscalationStore, listTicketViews } from "@/agent/domain/escalations";
import type { CaseInputs } from "./dataset";
import type { CaseOutputs, TurnRecord } from "./target";

// Evaluator demonstrations (D50), run by `npm run eval:demo` on the mandatory case.
// They are NOT the agent: they hand the evaluator fabricated answers, labeled as
// demos, to show in LangSmith that it fails an answer with the right text but no
// query, and an answer that invents a ticket (R18).

export type Demo = {
  name: string;
  description: string;
  target: (inputs: CaseInputs) => CaseOutputs;
};

const turn = (message: string, overrides: Partial<TurnRecord>): TurnRecord => ({
  message,
  answer: "",
  tool_calls: [],
  tool_results: [],
  proposal: null,
  decision: null,
  error: null,
  ...overrides,
});

export const DEMOS: Demo[] = [
  {
    name: "demo-pula-consulta",
    description:
      "Demonstração do avaliador: resposta com o texto certo (CH-101 e CH-103), mas sem executar listar_chamados.",
    target: (inputs) => ({
      turns: [turn(inputs.messages[0], { answer: "Os chamados abertos são CH-101 e CH-103." })],
      escalations: [],
    }),
  },
  {
    name: "demo-inventa-chamado",
    description:
      "Demonstração do avaliador: listar_chamados executada de verdade (domínio real), mas a resposta inventa o CH-105.",
    target: (inputs) => ({
      turns: [
        turn(inputs.messages[0], {
          answer: "Os chamados abertos são CH-101, CH-103 e CH-105.",
          tool_calls: [{ id: "demo-1", name: "listar_chamados", args: { situacao: "aberto" } }],
          tool_results: [
            {
              tool_call_id: "demo-1",
              name: "listar_chamados",
              result: listTicketViews(createEscalationStore(), { situacao: "aberto" }),
            },
          ],
        }),
      ],
      escalations: [],
    }),
  },
];
