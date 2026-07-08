import "server-only";

import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
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
    memberLevel: input.gameUserLevel ?? null,
    syncedAt: now,
    createdAt: now,
    updatedAt: now,
  });

  return ashedMemberId;
}
