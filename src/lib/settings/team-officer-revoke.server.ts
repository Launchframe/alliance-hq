import "server-only";

import { and, count, eq, inArray } from "drizzle-orm";

import { updateManualMembershipRole } from "@/lib/rbac/admin-users";
import { ROLE_IDS } from "@/lib/rbac/constants";
import { getDb, schema } from "@/lib/db";

export { canRevokeOfficerAccess } from "@/lib/settings/team-officer-revoke.shared";

const LEADERSHIP_ROLE_IDS = [
  ROLE_IDS.owner,
  ROLE_IDS.maintainer,
  ROLE_IDS.officer,
] as const;

export class TeamOfficerRevokeError extends Error {
  constructor(
    message: string,
    readonly code:
      | "FORBIDDEN"
      | "NOT_FOUND"
      | "INVALID"
      | "LAST_OFFICER"
      | "SELF",
  ) {
    super(message);
    this.name = "TeamOfficerRevokeError";
  }
}

export async function countActiveLeadershipMemberships(
  allianceId: string,
): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ value: count() })
    .from(schema.allianceMemberships)
    .where(
      and(
        eq(schema.allianceMemberships.allianceId, allianceId),
        eq(schema.allianceMemberships.status, "active"),
        inArray(schema.allianceMemberships.roleId, [...LEADERSHIP_ROLE_IDS]),
      ),
    );
  return Number(row?.value ?? 0);
}

/**
 * Demote an HQ officer membership to member. Keeps hq_users and commander links.
 * Sets source to manual so Ashed sync cannot re-escalate.
 */
export async function revokeOfficerMembershipToMember(input: {
  allianceId: string;
  membershipId: string;
  actorHqUserId: string;
}): Promise<{ membershipId: string; hqUserId: string }> {
  const db = getDb();
  const [existing] = await db
    .select({
      id: schema.allianceMemberships.id,
      hqUserId: schema.allianceMemberships.hqUserId,
      roleId: schema.allianceMemberships.roleId,
      allianceId: schema.allianceMemberships.allianceId,
      status: schema.allianceMemberships.status,
    })
    .from(schema.allianceMemberships)
    .where(eq(schema.allianceMemberships.id, input.membershipId))
    .limit(1);

  if (
    !existing ||
    existing.allianceId !== input.allianceId ||
    existing.status !== "active"
  ) {
    throw new TeamOfficerRevokeError("Membership not found.", "NOT_FOUND");
  }

  if (existing.hqUserId === input.actorHqUserId) {
    throw new TeamOfficerRevokeError(
      "You cannot remove your own officer access.",
      "SELF",
    );
  }

  if (existing.roleId !== ROLE_IDS.officer) {
    throw new TeamOfficerRevokeError(
      "Only officer access can be removed this way.",
      "INVALID",
    );
  }

  const leadershipCount = await countActiveLeadershipMemberships(
    input.allianceId,
  );
  if (leadershipCount <= 1) {
    throw new TeamOfficerRevokeError(
      "Invite a replacement officer before removing the last one.",
      "LAST_OFFICER",
    );
  }

  await updateManualMembershipRole(existing.id, ROLE_IDS.member);
  return { membershipId: existing.id, hqUserId: existing.hqUserId };
}
