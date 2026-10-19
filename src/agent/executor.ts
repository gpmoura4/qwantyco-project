import { ToolMessage, type ToolCall } from "@langchain/core/messages";
import { z } from "zod";
import { fail, type ToolResult } from "./domain/schemas";
import type { AllowedTool } from "./tools";

// The executor is the only place where a tool call from the model turns into
// a real execution. It never trusts the model: name and arguments are checked
// in code before anything runs, and every outcome goes back as a ToolMessage.
export async function executeToolCall(
  call: ToolCall,
  allowlist: Map<string, AllowedTool>,
): Promise<ToolMessage> {
  const reply = (result: ToolResult<unknown>) =>
    new ToolMessage({
      content: JSON.stringify(result),
      tool_call_id: call.id ?? "",
      name: call.name,
      status: result.ok ? "success" : "error",
    });

  // 1. Allowlist: unknown (or not yet enabled) tools never run.
  const entry = allowlist.get(call.name);
  if (!entry) {
    return reply(
      fail("UNKNOWN_TOOL", `A ferramenta "${call.name}" não existe ou não está disponível.`),
    );
  }

  // 2. Arguments: validated (and normalized) with the tool's Zod schema.
  const parsed = entry.schema.safeParse(call.args);
  if (!parsed.success) {
    return reply(
      fail(
        "INVALID_ARGS",
        `Argumentos inválidos para "${call.name}": ${z.prettifyError(parsed.error)}`,
      ),
    );
  }

  // 3. Execute through the LangChain tool (shows up as a tool run in LangSmith).
  const result = (await entry.tool.invoke(parsed.data)) as ToolResult<unknown>;
  return reply(result);
}
