import "server-only";

import { syncCommanderLevelForMemberIfLinked } from "@/lib/member-level/sync-from-member.server";
import { normalizeMemberHqLevel } from "@/lib/members/member-level.shared";

/** Persist in-game level from Last War UID lookup onto the linked Commander. */
export async function syncAllianceMemberGameLevelFromLastWar(input: {
  allianceId: string;
  ashedMemberId: string;
  gameUserLevel: number;
  memberName?: string | null;
  hqUserId?: string | null;
}): Promise<void> {
  const level = normalizeMemberHqLevel(input.gameUserLevel);
  if (level == null) return;

  await syncCommanderLevelForMemberIfLinked({
    allianceId: input.allianceId,
    ashedMemberId: input.ashedMemberId,
    memberName: input.memberName ?? input.ashedMemberId,
    memberLevel: level,
    source: "web",
    hqUserId: input.hqUserId ?? null,
  });
}
