import "server-only";

import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { getDiscordHqLink } from "@/lib/vr/repository";

const INVITE_MEMBER_LINK_KINDS = ["email", "protected_link"] as const;

export async function isInviteGatedMemberLink(input: {
  allianceId: string;
  hqUserId?: string | null;
  discordUserId?: string | null;
}): Promise<{
  gated: boolean;
  inviteId?: string | null;
  joinCodeId?: string | null;
}> {
  let hqUserId = input.hqUserId?.trim() || null;
  if (!hqUserId && input.discordUserId) {
    const link = await getDiscordHqLink(input.discordUserId);
    hqUserId = link?.hqUserId ?? null;
  }
  if (!hqUserId) {
    return { gated: false };
  }

  const db = getDb();

  const [invite] = await db
    .select({ id: schema.hqInvites.id })
    .from(schema.hqInvites)
    .where(
      and(
        eq(schema.hqInvites.allianceId, input.allianceId),
        eq(schema.hqInvites.acceptedByHqUserId, hqUserId),
        isNotNull(schema.hqInvites.acceptedAt),
        isNull(schema.hqInvites.targetAshedMemberId),
        inArray(schema.hqInvites.kind, [...INVITE_MEMBER_LINK_KINDS]),
      ),
    )
    .orderBy(desc(schema.hqInvites.acceptedAt))
    .limit(1);

  if (invite) {
    return { gated: true, inviteId: invite.id, joinCodeId: null };
  }

  const [joinCode] = await db
    .select({
      joinCodeId: schema.hqAllianceJoinCodeRedemptions.joinCodeId,
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
        eq(schema.hqAllianceJoinCodeRedemptions.hqUserId, hqUserId),
        isNull(schema.hqAllianceJoinCodes.targetAshedMemberId),
      ),
    )
    .orderBy(desc(schema.hqAllianceJoinCodeRedemptions.redeemedAt))
    .limit(1);

  if (joinCode) {
    return { gated: true, inviteId: null, joinCodeId: joinCode.joinCodeId };
  }

  return { gated: false };
}
