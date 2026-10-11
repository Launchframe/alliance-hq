import "server-only";

import { and, eq, isNotNull, sql } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";

/**
 * True when another HQ user accepted a claim-bound invite/join-code for this
 * commander and has not finished linking yet. Blocks seat sniping between
 * accept and claim confirm.
 */
export async function isCommanderReservedByPendingClaim(input: {
  allianceId: string;
  ashedMemberId: string;
  /** HQ user allowed to complete the pending claim (null = any reservation blocks). */
  allowedHqUserId?: string | null;
}): Promise<boolean> {
  const db = getDb();
  const ashedMemberId = input.ashedMemberId.trim();
  if (!ashedMemberId) return false;

  const [inviteReservation] = await db
    .select({ hqUserId: schema.hqInvites.acceptedByHqUserId })
    .from(schema.hqInvites)
    .where(
      and(
        eq(schema.hqInvites.allianceId, input.allianceId),
        eq(schema.hqInvites.targetAshedMemberId, ashedMemberId),
        isNotNull(schema.hqInvites.acceptedAt),
        isNotNull(schema.hqInvites.acceptedByHqUserId),
        sql`not exists (
          select 1 from ${schema.hqMemberLinks}
          where ${schema.hqMemberLinks.allianceId} = ${schema.hqInvites.allianceId}
            and ${schema.hqMemberLinks.hqUserId} = ${schema.hqInvites.acceptedByHqUserId}
        )`,
      ),
    )
    .limit(1);

  if (
    inviteReservation?.hqUserId &&
    inviteReservation.hqUserId !== input.allowedHqUserId
  ) {
    return true;
  }

  const [joinReservation] = await db
    .select({
      hqUserId: schema.hqAllianceJoinCodeRedemptions.hqUserId,
    })
    .from(schema.hqAllianceJoinCodeRedemptions)
    .innerJoin(
      schema.hqAllianceJoinCodes,
      eq(
        schema.hqAllianceJoinCodeRedemptions.joinCodeId,
        schema.hqAllianceJoinCodes.id,
      ),
    )
    .where(
      and(
        eq(schema.hqAllianceJoinCodes.allianceId, input.allianceId),
        eq(schema.hqAllianceJoinCodes.targetAshedMemberId, ashedMemberId),
        sql`not exists (
          select 1 from ${schema.hqMemberLinks}
          where ${schema.hqMemberLinks.allianceId} = ${schema.hqAllianceJoinCodes.allianceId}
            and ${schema.hqMemberLinks.hqUserId} = ${schema.hqAllianceJoinCodeRedemptions.hqUserId}
        )`,
      ),
    )
    .limit(1);

  if (
    joinReservation?.hqUserId &&
    joinReservation.hqUserId !== input.allowedHqUserId
  ) {
    return true;
  }

  return false;
}
