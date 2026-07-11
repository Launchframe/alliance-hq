import "server-only";

import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import { syncCommanderFromAllianceMember } from "@/lib/members/commander-identity.server";
import { nativeRosterAshedAllianceId } from "@/lib/native-alliance/provision";

export async function createNativeAllianceMemberForRosterLink(input: {
  allianceId: string;
  gameUserName: string;
  gameUserLevel?: number | null;
}): Promise<string> {
  const db = getDb();
  const now = new Date();
  const ashedMemberId = nanoid(16);
  const ashedAllianceId = nativeRosterAshedAllianceId(input.allianceId);

  await db.insert(schema.allianceMembers).values({
    id: nanoid(),
    allianceId: input.allianceId,
    ashedMemberId,
    ashedAllianceId,
    currentName: input.gameUserName,
    previousNamesJson: [],
    status: "active",
    syncedAt: now,
    createdAt: now,
    updatedAt: now,
  });

  if (input.gameUserLevel != null) {
    await syncCommanderFromAllianceMember({
      allianceId: input.allianceId,
      ashedMemberId,
      memberDisplayName: input.gameUserName,
      ashedStats: { memberLevel: input.gameUserLevel },
    });
  }

  return ashedMemberId;
}
