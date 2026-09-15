import "server-only";

import { KnowledgeAccessError } from "@/lib/notes/resources.server";

export async function streamOfficerIntelAsk(input: { allianceId: string; hqUserId: string | null; question: string; threadId?: string | null }): Promise<Response> {
  void input;
  throw new KnowledgeAccessError("not_configured");
}
