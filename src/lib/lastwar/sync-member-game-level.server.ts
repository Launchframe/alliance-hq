import "server-only";

import { and, eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";

/** Persist HQ roster level from Last War UID lookup (Discord /link). */
export async function syncAllianceMemberGameLevelFromLastWar(input: {
  allianceId: string;
  ashedMemberId: string;
  gameUserLevel: number;
}): Promise<void> {
  const db = getDb();
  const now = new Date();

  const [existing] = await db
    .select({
      id: schema.allianceMembers.id,
      memberLevel: schema.allianceMembers.memberLevel,
    })
    .from(schema.allianceMembers)
    .where(
      and(
        eq(schema.allianceMembers.allianceId, input.allianceId),
        eq(schema.allianceMembers.ashedMemberId, input.ashedMemberId),
      ),
    )
    .limit(1);

  if (!existing || existing.memberLevel === input.gameUserLevel) {
    return;
  }

  await db
    .update(schema.allianceMembers)
    .set({ memberLevel: input.gameUserLevel, updatedAt: now })
    .where(eq(schema.allianceMembers.id, existing.id));
}
