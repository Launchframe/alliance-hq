import "server-only";

export async function streamOfficerIntelAsk(input: {
  allianceId: string;
  hqUserId: string | null;
  question: string;
  threadId?: string | null;
}): Promise<Response> {
  void input;
  // Privacy cutover: ask retrieval is not consent-aware yet. Match the HTTP route stub.
  return Response.json(
    { error: "LLM synthesis is not configured.", code: "not_configured" },
    { status: 503 },
  );
}
