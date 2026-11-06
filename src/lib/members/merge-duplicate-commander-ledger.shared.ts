/**
 * Contracts for member-keyed ledgers that commander merge must remap.
 * Kept-side rows win unique clashes (same pattern as vs_score_heads).
 */

/** Matches `evidence-repository.server.ts` remoteKey construction (`${boardId}` stringifies null). */
export function hqEventSyncRemoteKey(
  eventId: string,
  boardId: string | null,
  memberId: string,
): string {
  return `${eventId}:${boardId}:${memberId}`;
}

export const MERGE_MEMBER_LEDGER_TABLES = [
  "hq_event_observations",
  "hq_event_member_results",
  "hq_event_sync_items",
  "vs_compliance_evaluations",
  "vs_compliance_actions",
  "vs_compliance_sync_jobs",
  "vs_compliance_roster_guards",
  "vs_score_manual_edits",
] as const;
