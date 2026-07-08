import "server-only";

import type { AllianceMember } from "@/lib/db/schema";
import { shouldSyncRosterFromAshed } from "@/lib/members/roster-sync.shared";

export async function allianceMembersAfterOptionalAshedSync(input: {
  forceRefresh: boolean;
  lastSyncedAt: Date | null;
  localRows: AllianceMember[];
  syncFromAshed: () => Promise<void>;
  reloadMembers: () => Promise<AllianceMember[]>;
}): Promise<AllianceMember[]> {
  if (
    shouldSyncRosterFromAshed({
      forceRefresh: input.forceRefresh,
      lastSyncedAt: input.lastSyncedAt,
      localMemberCount: input.localRows.length,
    })
  ) {
    await input.syncFromAshed();
    return input.reloadMembers();
  }

  return input.localRows;
}
