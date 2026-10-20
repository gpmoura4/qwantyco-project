import { DecisionRequestSchema, sendDecision } from "@/agent/chat";
import { getRuntime } from "@/agent/runtime";
import { parseBody, toResponse } from "../http";

// POST /api/chat/decision  { sessionId, proposta_id, decisao } → result of the decision.
export async function POST(request: Request): Promise<Response> {
  const body = await parseBody(request, DecisionRequestSchema);
  if (!body.ok) return toResponse(body);

  return toResponse(await sendDecision(getRuntime(), body.data));
}
