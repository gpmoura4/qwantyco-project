import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Same "@/*" alias as tsconfig.json, so tests import the core like the app does.
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    // Tests are offline: never send traces, even if the shell exports LangSmith vars (D44).
    // Any of these set to "true" turns tracing on, so all of them are pinned.
    env: {
      LANGSMITH_TRACING: "false",
      LANGSMITH_TRACING_V2: "false",
      LANGCHAIN_TRACING: "false",
      LANGCHAIN_TRACING_V2: "false",
    },
    include: ["tests/**/*.test.ts"],
  },
});
