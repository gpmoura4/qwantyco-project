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
import { hangUntilAborted, TransientToolError, type Faults } from "./faults";
import type { AllowedTool } from "./tools";

// What the executor produces for one tool call: either a result to send back to
// the model, or a proposal that must wait for a human decision.
export type ExecutionOutcome =
  | { kind: "result"; message: ToolMessage }
  | { kind: "proposal"; proposal: Proposal };

export type ExecutorContext = {
  allowlist: Map<string, AllowedTool>;
  store: EscalationStore;
  faults: Faults;
  // Attempts per tool call, so a simulated fault fails only the first N attempts.
  attempts: Map<string, number>;
  // Aborted by the node timeout; a hanging tool stops when it fires.
  signal?: AbortSignal;
};

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
// rules are checked in code before anything runs, and the output is checked
// before the model sees it.
export async function executeToolCall(
  call: ToolCall,
  ctx: ExecutorContext,
): Promise<ExecutionOutcome> {
  const result = (r: ToolResult<unknown>): ExecutionOutcome => ({
    kind: "result",
    message: toToolMessage(call.id ?? "", call.name, r),
  });

  // 1. Allowlist: unknown tools never run.
  const entry = ctx.allowlist.get(call.name);
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
    const allowed = checkEscalationAllowed(ctx.store, args.chamado_id);
    if (!allowed.ok) return result(allowed);
    return { kind: "proposal", proposal: { id: `prop-${randomUUID()}`, ...args } };
  }

  // 3b. Read operation: execute through the LangChain tool (traced as a tool run).
  // A simulated "error" or "timeout" throws, so the node's retry policy kicks in.
  const output =
    (await simulateFault(call, ctx)) ?? (await entry.tool.invoke(parsed.data));

  // 4. Output: never hand data outside the contract to the model.
  if (entry.outputSchema && !entry.outputSchema.safeParse(output).success) {
    return result(
      fail(
        "INVALID_OUTPUT",
        `A ferramenta "${call.name}" retornou dados fora do contrato; o resultado foi descartado.`,
      ),
    );
  }
  return result(output as ToolResult<unknown>);
}

// Returns a corrupted output for "invalid_output", throws for "error"/"timeout",
// and returns undefined when no fault applies to this attempt.
async function simulateFault(call: ToolCall, ctx: ExecutorContext): Promise<unknown> {
  const fault = ctx.faults[call.name];
  if (!fault) return undefined;

  const key = call.id ?? call.name;
  const attempt = (ctx.attempts.get(key) ?? 0) + 1;
  ctx.attempts.set(key, attempt);
  if (attempt > fault.times) return undefined;

  if (fault.mode === "error") {
    throw new TransientToolError(`Falha simulada em "${call.name}" (tentativa ${attempt}).`);
  }
  if (fault.mode === "timeout") return hangUntilAborted(ctx.signal);
  return { corrupted: true };
}
