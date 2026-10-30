import "server-only";

import type { AllianceMember } from "@/lib/db/schema";
import { shouldSyncRosterFromAshed } from "@/lib/members/roster-sync.shared";

export async function allianceMembersAfterOptionalAshedSync(input: {
  forceRefresh: boolean;
  lastSyncedAt: Date | null;
  localRows: AllianceMember[];
  /** Blocking sync (empty roster, or callers that must await). */
  syncFromAshed: () => Promise<void>;
  reloadMembers: () => Promise<AllianceMember[]>;
  /**
   * When the roster is non-empty and sync is due, enqueue instead of awaiting.
   * Return true when a background run was claimed (or already running is fine).
   */
  enqueueBackgroundSync?: () => Promise<void>;
}): Promise<AllianceMember[]> {
  if (
    !shouldSyncRosterFromAshed({
      forceRefresh: input.forceRefresh,
      lastSyncedAt: input.lastSyncedAt,
      localMemberCount: input.localRows.length,
    })
  ) {
    return input.localRows;
  }

  // Empty roster: block so officers never flash a blank list.
  if (input.localRows.length === 0) {
    await input.syncFromAshed();
    return input.reloadMembers();
  }

  // Non-empty: prefer background enqueue when provided.
  if (input.enqueueBackgroundSync) {
    await input.enqueueBackgroundSync();
    return input.localRows;
  }

  await input.syncFromAshed();
  return input.reloadMembers();
}
