// Manual smoke test against the real local model (not part of `npm test`).
// Usage: npm run smoke   (override the model: OLLAMA_MODEL=<tag> npm run smoke)
import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";
import { buildGraph } from "@/agent/graph";
import { createChatModel } from "@/agent/model";

// Each conversation is a separate session; turns inside it share context.
const CONVERSATIONS: string[][] = [
  ["Liste todos os chamados abertos."],
  ["Consulte o CH-102."],
  ["Consulte o CH-999."],
  ["Consulte o CH-101.", "Qual é o cliente desse chamado?"],
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
  const graph = buildGraph({ model: createChatModel(), checkpointer: new MemorySaver() });
  console.log(`Model: ${process.env.OLLAMA_MODEL}\n`);

  for (const [index, turns] of CONVERSATIONS.entries()) {
    const config = { configurable: { thread_id: `smoke-${index}` } };
    for (const text of turns) {
      console.log(`[user] ${text}`);
      const before = (await graph.getState(config)).values.messages?.length ?? 0;
      const started = Date.now();
      const result = await graph.invoke({ messages: [new HumanMessage(text)] }, config);
      // Skip the human message itself; print what the graph produced.
      result.messages.slice(before + 1).forEach(print);
      console.log(`  (${Date.now() - started} ms)\n`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
