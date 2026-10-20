// Manual smoke test against the real local model (not part of `npm test`).
// Usage: npm run smoke   (override the model: OLLAMA_MODEL=<tag> npm run smoke)
import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";
import { decideProposal, getPendingProposal } from "@/agent/approval";
import { createEscalationStore } from "@/agent/domain/escalations";
import type { Decision } from "@/agent/domain/schemas";
import { parseFaults } from "@/agent/faults";
import { buildGraph } from "@/agent/graph";
import { createChatModel } from "@/agent/model";
import { runAgent } from "@/agent/run";

// Each conversation is a separate session; turns inside it share context.
// `decisao` simulates the human answer if the graph pauses for approval.
const CONVERSATIONS: { turns: string[]; decisao?: Decision["decisao"] }[] = [
  { turns: ["Liste todos os chamados abertos."] },
  { turns: ["Consulte o CH-102."] },
  { turns: ["Consulte o CH-999."] },
  { turns: ["Consulte o CH-101.", "Qual é o cliente desse chamado?"] },
  { turns: ["Consulte o CH-101 e prepare um escalonamento se ele estiver aberto."], decisao: "aprovar" },
  { turns: ["Consulte o CH-103 e prepare um escalonamento se ele estiver aberto."], decisao: "rejeitar" },
  { turns: ["Consulte o CH-102 e prepare um escalonamento se ele estiver aberto."], decisao: "aprovar" },
];

function print(message: BaseMessage) {
  if (AIMessage.isInstance(message) && message.tool_calls?.length) {
    for (const call of message.tool_calls) {
      console.log(`  [tool call] ${call.name} ${JSON.stringify(call.args)}`);
    }
  } else if (ToolMessage.isInstance(message)) {
    console.log(`  [tool result:${message.status}] ${message.content}`);
  } else if (AIMessage.isInstance(message)) {
    console.log(`  [assistant] ${message.content}`);
  }
}

async function main() {
  const escalationStore = createEscalationStore();
  const graph = buildGraph({
    model: createChatModel(),
    checkpointer: new MemorySaver(),
    escalationStore,
    faults: parseFaults(process.env.SIMULATE_TOOL_FAILURE),
  });
  console.log(`Model: ${process.env.OLLAMA_MODEL}`);
  console.log(`Simulated failures: ${process.env.SIMULATE_TOOL_FAILURE || "none"}\n`);

  for (const [index, { turns, decisao }] of CONVERSATIONS.entries()) {
    const threadId = `smoke-${index}`;
    const config = { configurable: { thread_id: threadId } };
    for (const text of turns) {
      console.log(`[user] ${text}`);
      const before = (await graph.getState(config)).values.messages?.length ?? 0;
      const started = Date.now();
      const run = await runAgent(graph, { messages: [new HumanMessage(text)] }, threadId);
      if (run.ok) {
        // Skip the human message itself; print what the graph produced.
        run.data.messages.slice(before + 1).forEach(print);
      } else {
        console.log(`  [erro controlado] ${run.error.code}: ${run.error.message}`);
      }
      console.log(`  (${Date.now() - started} ms)`);

      const proposal = await getPendingProposal(graph, threadId);
      if (proposal && decisao) {
        console.log(`  [proposta aguardando aprovação] ${JSON.stringify(proposal)}`);
        console.log(`  [humano] ${decisao}`);
        const decision = await decideProposal({
          graph,
          escalationStore,
          threadId,
          decision: { proposta_id: proposal.id, decisao },
        });
        console.log(`  [resultado] ${JSON.stringify(decision)}`);
      }
      console.log();
    }
  }
  console.log(`Escalonamentos registrados: ${JSON.stringify(escalationStore.list(), null, 2)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
