import "server-only";

import { and, eq, isNotNull } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { assignManualMembership } from "@/lib/rbac/admin-users";
import { ROLE_IDS, type SystemRoleName } from "@/lib/rbac/constants";
import { systemRoleNameForId } from "@/lib/rbac/system-roles";

import { assertHybridClaimInviteRankAtAccept } from "./invite-accept-rank.server";
import { findAcceptedClaimInviteForUser } from "./invites";
import {
  resolveProvisionRoleId,
} from "./provision-membership";

/**
 * After a successful claim confirm, apply the invite/join-code role that was
 * deferred at accept time (member until the bound commander is linked).
 *
 * Re-checks hybrid owner/officer rank gates here — accept-time checks alone are
 * insufficient once elevated RBAC is deferred until claim confirm (#754).
 */
export async function elevateMembershipAfterClaimLink(input: {
  allianceId: string;
  hqUserId: string;
  ownerEmail?: string | null;
}): Promise<{ elevated: boolean; roleName: SystemRoleName | null }> {
  const claim = await findAcceptedClaimInviteForUser(
    input.allianceId,
    input.hqUserId,
  );
  if (!claim) {
    return { elevated: false, roleName: null };
  }

  const claimSource = await loadClaimSourceRoleId({
    allianceId: input.allianceId,
    hqUserId: input.hqUserId,
    inviteId: claim.inviteId,
  });
  if (!claimSource?.roleId) {
    return { elevated: false, roleName: null };
  }
  const { roleId: inviteRoleId, invitedByHqUserId } = claimSource;

  // Fail closed if the claim commander was demoted between accept and confirm.
  await assertHybridClaimInviteRankAtAccept({
    allianceId: input.allianceId,
    roleId: inviteRoleId,
    targetAshedMemberId: claim.targetAshedMemberId,
    invitedByHqUserId,
  });

  const db = getDb();
  const [existing] = await db
    .select({
      roleId: schema.allianceMemberships.roleId,
      status: schema.allianceMemberships.status,
    })
    .from(schema.allianceMemberships)
    .where(
      and(
        eq(schema.allianceMemberships.hqUserId, input.hqUserId),
        eq(schema.allianceMemberships.allianceId, input.allianceId),
      ),
    )
    .limit(1);

  const roleId = resolveProvisionRoleId({
    inviteRoleId,
    existingRoleId: existing?.roleId,
    existingStatus: existing?.status,
    rolePolicy: "never_demote",
  });

  await assignManualMembership({
    hqUserId: input.hqUserId,
    allianceId: input.allianceId,
    roleId,
  });
  const roleName = systemRoleNameForId(roleId);
  const inviteRoleName = systemRoleNameForId(inviteRoleId);
  if (inviteRoleName === "owner" && roleId === ROLE_IDS.owner) {
    const [alliance] = await db
      .select({
        ownerEmail: schema.alliances.ownerEmail,
      })
      .from(schema.alliances)
      .where(eq(schema.alliances.id, input.allianceId))
      .limit(1);
    const ownerEmail =
      input.ownerEmail?.trim() || alliance?.ownerEmail?.trim() || null;
    await db
      .update(schema.alliances)
      .set({
        ownerHqUserId: input.hqUserId,
        ownerEmail,
        updatedAt: new Date(),
      })
      .where(eq(schema.alliances.id, input.allianceId));
  }

  return {
    elevated: roleId === inviteRoleId && inviteRoleId !== ROLE_IDS.member,
    roleName,
  };
}

async function loadClaimSourceRoleId(input: {
  allianceId: string;
  hqUserId: string;
  inviteId: string;
}): Promise<{ roleId: string; invitedByHqUserId: string | null } | null> {
  const db = getDb();
  const [invite] = await db
    .select({
      roleId: schema.hqInvites.roleId,
      invitedByHqUserId: schema.hqInvites.invitedByHqUserId,
    })
    .from(schema.hqInvites)
    .where(
      and(
        eq(schema.hqInvites.id, input.inviteId),
        eq(schema.hqInvites.allianceId, input.allianceId),
        eq(schema.hqInvites.acceptedByHqUserId, input.hqUserId),
        isNotNull(schema.hqInvites.acceptedAt),
        isNotNull(schema.hqInvites.targetAshedMemberId),
      ),
    )
    .limit(1);
  if (invite?.roleId) {
    return {
      roleId: invite.roleId,
      invitedByHqUserId: invite.invitedByHqUserId ?? null,
    };
  }

  const [joinCode] = await db
    .select({
      roleId: schema.hqAllianceJoinCodes.roleId,
      createdByHqUserId: schema.hqAllianceJoinCodes.createdByHqUserId,
    })
    .from(schema.hqAllianceJoinCodes)
    .innerJoin(
      schema.hqAllianceJoinCodeRedemptions,
      eq(
        schema.hqAllianceJoinCodeRedemptions.joinCodeId,
        schema.hqAllianceJoinCodes.id,
      ),
    )
    .where(
      and(
        eq(schema.hqAllianceJoinCodes.id, input.inviteId),
        eq(schema.hqAllianceJoinCodes.allianceId, input.allianceId),
        eq(schema.hqAllianceJoinCodeRedemptions.hqUserId, input.hqUserId),
        isNotNull(schema.hqAllianceJoinCodes.targetAshedMemberId),
      ),
    )
    .limit(1);

  if (!joinCode?.roleId) {
    return null;
  }
  return {
    roleId: joinCode.roleId,
    // Join-code issuer is the hybrid-rank exception principal (same as invite).
    invitedByHqUserId: joinCode.createdByHqUserId ?? null,
  };
}
