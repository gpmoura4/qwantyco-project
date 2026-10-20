import { randomUUID } from "node:crypto";
import { ToolMessage, type ToolCall } from "@langchain/core/messages";
import { z } from "zod";
import { checkEscalationAllowed, type EscalationStore } from "./domain/escalations";
import {
  fail,
  type Proposal,
  type RegisterEscalationInput,
  type ToolResult,
} from "./domain/schemas";
import type { AllowedTool } from "./tools";

// What the executor produces for one tool call: either a result to send back to
// the model, or a proposal that must wait for a human decision.
export type ExecutionOutcome =
  | { kind: "result"; message: ToolMessage }
  | { kind: "proposal"; proposal: Proposal };

export function toToolMessage(
  toolCallId: string,
  name: string,
  result: ToolResult<unknown>,
): ToolMessage {
  return new ToolMessage({
    content: JSON.stringify(result),
    tool_call_id: toolCallId,
    name,
    status: result.ok ? "success" : "error",
  });
}

// The executor is the only place where a tool call from the model turns into
// a real execution. It never trusts the model: name, arguments and business
// rules are checked in code before anything runs.
export async function executeToolCall(
  call: ToolCall,
  allowlist: Map<string, AllowedTool>,
  store: EscalationStore,
): Promise<ExecutionOutcome> {
  const result = (r: ToolResult<unknown>): ExecutionOutcome => ({
    kind: "result",
    message: toToolMessage(call.id ?? "", call.name, r),
  });

  // 1. Allowlist: unknown tools never run.
  const entry = allowlist.get(call.name);
  if (!entry) {
    return result(
      fail("UNKNOWN_TOOL", `A ferramenta "${call.name}" não existe ou não está disponível.`),
    );
  }

  // 2. Arguments: validated (and normalized) with the tool's Zod schema.
  const parsed = entry.schema.safeParse(call.args);
  if (!parsed.success) {
    return result(
      fail(
        "INVALID_ARGS",
        `Argumentos inválidos para "${call.name}": ${z.prettifyError(parsed.error)}`,
      ),
    );
  }

  // 3a. Write operation: check the business rules now (so a resolved ticket never
  // reaches the human), then return a proposal. Nothing is registered here.
  if (entry.requiresApproval) {
    const args = parsed.data as RegisterEscalationInput;
    const allowed = checkEscalationAllowed(store, args.chamado_id);
    if (!allowed.ok) return result(allowed);
    return { kind: "proposal", proposal: { id: `prop-${randomUUID()}`, ...args } };
  }

  // 3b. Read operation: execute through the LangChain tool (traced as a tool run).
  return result((await entry.tool.invoke(parsed.data)) as ToolResult<unknown>);
}
