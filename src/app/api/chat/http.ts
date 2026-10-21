import { awaitAllCallbacks } from "@langchain/core/callbacks/promises";
import { after } from "next/server";
import { z } from "zod";
import type { ErrorCode, ToolResult } from "@/agent/domain/schemas";

// Translates core results into HTTP. No business rule lives here.

// Sends the pending LangSmith traces once the response is out (D42): the reply is
// not delayed, and the traces are not lost where the process stops after the
// response (serverless).
export function flushTracesAfterResponse(): void {
  after(() => awaitAllCallbacks());
}

const STATUS: Partial<Record<ErrorCode, number>> = {
  INVALID_REQUEST: 400,
  PROPOSAL_PENDING: 409,
  NO_PENDING_PROPOSAL: 409,
  PROPOSAL_MISMATCH: 409,
  EXECUTION_LIMIT: 503,
  EXECUTION_FAILED: 503,
};

export function toResponse(result: ToolResult<unknown>): Response {
  if (result.ok) return Response.json(result.data);
  return Response.json({ error: result.error }, { status: STATUS[result.error.code] ?? 500 });
}

// Reads and validates a JSON body; invalid JSON or schema errors become 400.
export async function parseBody<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<ToolResult<z.infer<T>>> {
  const body = await request.json().catch(() => undefined);
  const parsed = schema.safeParse(body);
  if (parsed.success) return { ok: true, data: parsed.data };
  return {
    ok: false,
    error: { code: "INVALID_REQUEST", message: `Requisição inválida: ${z.prettifyError(parsed.error)}` },
  };
}
