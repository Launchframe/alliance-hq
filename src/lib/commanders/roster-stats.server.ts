import "server-only";

import { and, eq, isNull } from "drizzle-orm";

import { commanderThpTotal } from "@/lib/commanders/power-stats.shared";
import { getDb, schema } from "@/lib/db";

export type CommanderRosterStats = {
  powerLevel: string | null;
  totalHeroPower: number;
};

export async function loadCommanderRosterStatsByMember(
  allianceId: string,
): Promise<Map<string, CommanderRosterStats>> {
  const db = getDb();
  const rows = await db
    .select({
      ashedMemberId: schema.commanderAllianceMemberships.ashedMemberId,
      powerLevel: schema.commanders.powerLevel,
      currentTotalHeroPower: schema.commanders.currentTotalHeroPower,
    })
    .from(schema.commanderAllianceMemberships)
    .innerJoin(
      schema.commanders,
      eq(schema.commanders.id, schema.commanderAllianceMemberships.commanderId),
    )
    .where(
      and(
        eq(schema.commanderAllianceMemberships.allianceId, allianceId),
        isNull(schema.commanderAllianceMemberships.leftAt),
      ),
    );

  const byMember = new Map<string, CommanderRosterStats>();
  for (const row of rows) {
    byMember.set(row.ashedMemberId, {
      powerLevel: row.powerLevel ?? null,
      totalHeroPower: commanderThpTotal({
        currentTotalHeroPower: row.currentTotalHeroPower,
      }),
    });
  }
  return byMember;
}
