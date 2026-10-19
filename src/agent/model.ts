import { ChatOllama } from "@langchain/ollama";

// Real chat model (local, via Ollama — D07). Configuration comes only from the
// environment; tests never call this (they inject a fake model).
export function createChatModel(): ChatOllama {
  const model = process.env.OLLAMA_MODEL;
  if (!model) throw new Error("OLLAMA_MODEL is not set (see .env.example).");

  return new ChatOllama({
    model,
    baseUrl: process.env.OLLAMA_BASE_URL || undefined,
    // Deterministic as possible: same question, same tool call.
    temperature: 0,
  });
}
