import "server-only";

import { and, count, eq } from "drizzle-orm";

import { escapeLikePrefix } from "@/lib/admin/audit-query";
import { getDb, schema } from "@/lib/db";
import type { KnowledgeActor } from "@/lib/notes/policy.shared";
import { KnowledgeAccessError, knowledgeAccessCondition } from "@/lib/notes/resources.server";
import type { OfficerActionItemRecord } from "@/lib/officer-intel/synthesis-types.shared";

export type OfficerIntelRetrievedChunk = {
  id: string;
  sourceType: "approved_note" | "action_item";
  sourceId: string;
  sessionId: string | null;
  text: string;
  sessionTitle: string | null;
  channelLabel: string | null;
  sessionAt: string | null;
  similarity: number;
};

export function buildOfficerIntelKeywordPattern(query: string): string {
  const trimmed = query.trim();
  if (!trimmed) return "%";
  return `%${escapeLikePrefix(trimmed)}%`;
}

export async function retrieveOfficerIntelCorpus(input: {
  allianceId: string;
  query: string;
  k?: number;
}): Promise<OfficerIntelRetrievedChunk[]> {
  void input;
  // Privacy cutover: corpus search stays alliance-wide until consent-aware retrieval lands.
  // Fail closed here so re-enabling the HTTP route (or any other caller) cannot restore the leak.
  throw new KnowledgeAccessError("not_configured");
}

export async function listOpenActionItemsForAsk(
  _allianceId: string,
): Promise<OfficerActionItemRecord[]> {
  return [];
}

export async function countApprovedOfficerMeetingNotes(
  allianceId: string,
  actor: KnowledgeActor,
): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ value: count() })
    .from(schema.officerMeetingNotes)
    .where(
      and(
        eq(schema.officerMeetingNotes.allianceId, allianceId),
        eq(schema.officerMeetingNotes.status, "approved"),
        knowledgeAccessCondition(actor, schema.officerMeetingNotes.resourceId),
      ),
    );
  return Number(row?.value ?? 0);
}

export async function loadSessionMessagesForAsk(_input: {
  allianceId: string;
  sessionId: string;
  limit?: number;
}): Promise<
  Array<{ senderName: string; localeText: string; sequenceOrder: number }>
> {
  return [];
}
