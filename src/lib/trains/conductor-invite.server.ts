import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { parsePowerLevelM } from "@/lib/commanders/power-stats.shared";
import { getDb, schema } from "@/lib/db";
import type { MemberInviteProfile } from "@/lib/trains/conductor-invite.shared";

export async function loadMemberInviteProfiles(
  allianceId: string,
  memberIds: string[],
): Promise<Record<string, MemberInviteProfile>> {
  const ids = [...new Set(memberIds.filter((id) => id.trim().length > 0))];
  if (ids.length === 0) return {};

  const rows = await getDb()
    .select({
      memberId: schema.commanderAllianceMemberships.ashedMemberId,
      canonicalName: schema.commanders.canonicalName,
      primaryName: schema.commanders.primaryName,
      powerLevel: schema.commanders.powerLevel,
    })
    .from(schema.commanderAllianceMemberships)
    .innerJoin(
      schema.commanders,
      eq(schema.commanders.id, schema.commanderAllianceMemberships.commanderId),
    )
    .where(
      and(
        eq(schema.commanderAllianceMemberships.allianceId, allianceId),
        eq(schema.commanderAllianceMemberships.status, "active"),
        inArray(schema.commanderAllianceMemberships.ashedMemberId, ids),
      ),
    );

  const profiles: Record<string, MemberInviteProfile> = {};
  for (const row of rows) {
    const name = row.canonicalName?.trim() || row.primaryName?.trim() || null;
    profiles[row.memberId] = {
      name,
      powerM: parsePowerLevelM(row.powerLevel),
    };
  }
  return profiles;
}
