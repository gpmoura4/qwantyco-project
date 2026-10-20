import { MessageRequestSchema, sendMessage } from "@/agent/chat";
import { getRuntime } from "@/agent/runtime";
import { parseBody, toResponse } from "./http";

// POST /api/chat  { sessionId, message } → reply, or the proposal awaiting approval.
export async function POST(request: Request): Promise<Response> {
  const body = await parseBody(request, MessageRequestSchema);
  if (!body.ok) return toResponse(body);

  return toResponse(await sendMessage(getRuntime(), body.data.sessionId, body.data.message));
}
