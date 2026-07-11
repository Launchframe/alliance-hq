import "server-only";

import { and, eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { getCommanderIdForMember } from "@/lib/thp/repository";

/** Persist in-game level from Last War UID lookup onto the linked Commander. */
export async function syncAllianceMemberGameLevelFromLastWar(input: {
  allianceId: string;
  ashedMemberId: string;
  gameUserLevel: number;
}): Promise<void> {
  const commanderId = await getCommanderIdForMember(
    input.allianceId,
    input.ashedMemberId,
  );
  if (!commanderId) {
    return;
  }

  const db = getDb();
  const now = new Date();
  const [existing] = await db
    .select({ memberLevel: schema.commanders.memberLevel })
    .from(schema.commanders)
    .where(eq(schema.commanders.id, commanderId))
    .limit(1);

  if (!existing || existing.memberLevel === input.gameUserLevel) {
    return;
  }

  await db
    .update(schema.commanders)
    .set({ memberLevel: input.gameUserLevel, updatedAt: now })
    .where(eq(schema.commanders.id, commanderId));
}
