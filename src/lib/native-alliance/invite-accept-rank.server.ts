import "server-only";

import { and, eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import {
  HYBRID_OFFICER_INVITE_RANK,
  HYBRID_OWNER_INVITE_RANK,
} from "@/lib/native-alliance/invite-rank-exceptions.shared";
import { systemRoleNameForId } from "@/lib/rbac/system-roles";

export const HYBRID_OWNER_RANK_STALE_MESSAGE = "Owner invite requires the claim commander to still be in-game R5.";

export const HYBRID_OFFICER_RANK_STALE_MESSAGE = "Officer invite requires the claim commander to still be in-game R4.";

export async function loadTargetAllianceRank(
  allianceId: string,
  targetAshedMemberId: string,
): Promise<number | null> {
  const db = getDb();
  const [row] = await db
    .select({
      allianceRank: schema.allianceMembers.allianceRank,
      status: schema.allianceMembers.status,
    })
    .from(schema.allianceMembers)
    .where(
      and(
        eq(schema.allianceMembers.allianceId, allianceId),
        eq(schema.allianceMembers.ashedMemberId, targetAshedMemberId),
      ),
    )
    .limit(1);

  if (!row || row.status === "former") {
    return null;
  }
  return row.allianceRank ?? null;
}

/**
 * True when an officer+claim invite could only have been created via the R4
 * hybrid exception (issuer is an HQ officer, not owner/admin/maintainer).
 */
async function officerInviteRequiredHybridRank(
  allianceId: string,
  invitedByHqUserId: string | null | undefined,
): Promise<boolean> {
  const issuerId = invitedByHqUserId?.trim() || null;
  if (!issuerId) {
    return false;
  }

  const db = getDb();
  const [membership] = await db
    .select({ roleId: schema.allianceMemberships.roleId })
    .from(schema.allianceMemberships)
    .where(
      and(
        eq(schema.allianceMemberships.allianceId, allianceId),
        eq(schema.allianceMemberships.hqUserId, issuerId),
        eq(schema.allianceMemberships.status, "active"),
      ),
    )
    .limit(1);

  return systemRoleNameForId(membership?.roleId ?? "") === "officer";
}

/**
 * Re-check hybrid rank gates at accept time.
 *
 * Create-time `assertInviteRoleAllowed` only snapshots rank when the invite is
 * minted. Without this gate, an R5 hybrid owner invite (or R4 hybrid officer
 * invite) still provisions elevated RBAC after the commander is demoted.
 */
export async function assertHybridClaimInviteRankAtAccept(input: {
  allianceId: string;
  roleId: string;
  targetAshedMemberId?: string | null;
  invitedByHqUserId?: string | null;
}): Promise<void> {
  const targetId = input.targetAshedMemberId?.trim() || null;
  if (!targetId) {
    return;
  }

  const roleName = systemRoleNameForId(input.roleId);
  if (roleName !== "owner" && roleName !== "officer") {
    return;
  }

  const rank = await loadTargetAllianceRank(input.allianceId, targetId);

  if (roleName === "owner") {
    // Owner invites with a claim target always required R5 at create (owner is
    // never in the base assignable set). Re-require R5 at accept.
    if (rank !== HYBRID_OWNER_INVITE_RANK) {
      throw new Error(HYBRID_OWNER_RANK_STALE_MESSAGE);
    }
    return;
  }

  if (
    await officerInviteRequiredHybridRank(
      input.allianceId,
      input.invitedByHqUserId,
    )
  ) {
    if (rank !== HYBRID_OFFICER_INVITE_RANK) {
      throw new Error(HYBRID_OFFICER_RANK_STALE_MESSAGE);
    }
  }
}
