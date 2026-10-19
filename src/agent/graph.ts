import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, SystemMessage } from "@langchain/core/messages";
import {
  END,
  MessagesValue,
  START,
  StateGraph,
  StateSchema,
  type BaseCheckpointSaver,
  type GraphNode,
} from "@langchain/langgraph";
import { executeToolCall } from "./executor";
import { SYSTEM_PROMPT } from "./prompt";
import { READ_ONLY_TOOLS } from "./tools";

// Typed graph state. Only the conversation for now; fields for the approval
// (step 4) and execution budget (step 5) are added when they are needed.
export const AgentState = new StateSchema({
  messages: MessagesValue,
});

type BuildGraphOptions = {
  // Injected so tests use a fake model through the same graph and executor.
  model: BaseChatModel;
  // Persists state per thread_id (one thread per chat session).
  checkpointer: BaseCheckpointSaver;
};

export function buildGraph({ model, checkpointer }: BuildGraphOptions) {
  if (!model.bindTools) throw new Error("The chat model does not support tool calling.");

  const allowlist = new Map(READ_ONLY_TOOLS.map((entry) => [entry.tool.name, entry]));
  const modelWithTools = model.bindTools(READ_ONLY_TOOLS.map((entry) => entry.tool));

  // Model node: the LLM decides whether to answer or to call tools.
  const callModel: GraphNode<typeof AgentState> = async (state) => {
    const response = await modelWithTools.invoke([
      new SystemMessage(SYSTEM_PROMPT),
      ...state.messages,
    ]);
    return { messages: [response] };
  };

  // Executor node: validates and runs every tool call of the last AI message.
  const executeTools: GraphNode<typeof AgentState> = async (state) => {
    const last = state.messages.at(-1);
    const calls = last && AIMessage.isInstance(last) ? (last.tool_calls ?? []) : [];
    const results = [];
    for (const call of calls) results.push(await executeToolCall(call, allowlist));
    return { messages: results };
  };

  const routeAfterModel = (state: typeof AgentState.State) => {
    const last = state.messages.at(-1);
    return last && AIMessage.isInstance(last) && last.tool_calls?.length ? "executeTools" : END;
  };

  // callModel -> (executeTools -> callModel)* -> END
  return new StateGraph(AgentState)
    .addNode("callModel", callModel)
    .addNode("executeTools", executeTools)
    .addEdge(START, "callModel")
    .addConditionalEdges("callModel", routeAfterModel, ["executeTools", END])
    .addEdge("executeTools", "callModel")
    .compile({ checkpointer });
}
