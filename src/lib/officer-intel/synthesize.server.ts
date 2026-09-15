import "server-only";

import type { KnowledgeActor } from "@/lib/notes/policy.shared";
import { getOfficerChatSessionForAlliance } from "./repository.server";

export async function synthesizeOfficerMeetingNote(input: {
  actor: KnowledgeActor; sessionId: string; allianceId: string; hqUserId: string | null;
  sessionTitle: string; channelLabel: string | null;
}): Promise<{ ok: true; noteId: string } | { error: "not_configured" | "no_messages" | "not_found" | "approved" }> {
  const source = await getOfficerChatSessionForAlliance(input);
  return { error: source ? "not_configured" : "not_found" };
}
