import "server-only";

import { and, eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { syncCommanderIdentityFromMemberLink } from "@/lib/members/commander-identity.server";
import { reconcileAllianceMemberForRosterLink } from "@/lib/member-link/roster-link-resolve.server";
import {
  deleteDiscordMemberLink,
  getDiscordHqLink,
  getDiscordLinkByAllianceAndMember,
} from "@/lib/vr/repository";

export function isMergeTargetClaimedByOther(input: {
  requesterHqUserId?: string | null;
  requesterDiscordUserId?: string | null;
  targetHqUserId?: string | null;
  targetDiscordUserId?: string | null;
  targetDiscordHqUserId?: string | null;
}): boolean {
  if (
    input.targetHqUserId &&
    input.targetHqUserId !== input.requesterHqUserId
  ) {
    return true;
  }

  if (!input.targetDiscordUserId) {
    return false;
  }

  if (input.targetDiscordUserId === input.requesterDiscordUserId) {
    return false;
  }

  if (
    input.requesterHqUserId &&
    input.targetDiscordHqUserId === input.requesterHqUserId
  ) {
    return false;
  }

  return true;
}

export async function mergeSelfServiceMemberIntoRosterTarget(input: {
  allianceId: string;
  sourceAshedMemberId: string;
  targetAshedMemberId: string;
  gameUserName: string;
  gameUid: string;
  hqUserId?: string | null;
  discordUserId?: string | null;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (input.sourceAshedMemberId === input.targetAshedMemberId) {
    return { ok: false, reason: "same_member" };
  }

  const db = getDb();
  const [sourceMember, targetMember] = await Promise.all([
    db
      .select()
      .from(schema.allianceMembers)
      .where(
        and(
          eq(schema.allianceMembers.allianceId, input.allianceId),
          eq(schema.allianceMembers.ashedMemberId, input.sourceAshedMemberId),
        ),
      )
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db
      .select()
      .from(schema.allianceMembers)
      .where(
        and(
          eq(schema.allianceMembers.allianceId, input.allianceId),
          eq(schema.allianceMembers.ashedMemberId, input.targetAshedMemberId),
        ),
      )
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ]);

  if (!sourceMember || !targetMember) {
    return { ok: false, reason: "target_not_found" };
  }
  if (targetMember.status === "former") {
    return { ok: false, reason: "target_not_found" };
  }

  const [targetHqLink, targetDiscordLink] = await Promise.all([
    db
      .select()
      .from(schema.hqMemberLinks)
      .where(
        and(
          eq(schema.hqMemberLinks.allianceId, input.allianceId),
          eq(schema.hqMemberLinks.ashedMemberId, input.targetAshedMemberId),
        ),
      )
      .limit(1)
      .then((rows) => rows[0] ?? null),
    getDiscordLinkByAllianceAndMember(
      input.allianceId,
      input.targetAshedMemberId,
    ),
  ]);
  const targetDiscordHqLink = targetDiscordLink
    ? await getDiscordHqLink(targetDiscordLink.discordUserId)
    : null;

  if (
    isMergeTargetClaimedByOther({
      requesterHqUserId: input.hqUserId,
      requesterDiscordUserId: input.discordUserId,
      targetHqUserId: targetHqLink?.hqUserId ?? null,
      targetDiscordUserId: targetDiscordLink?.discordUserId ?? null,
      targetDiscordHqUserId: targetDiscordHqLink?.hqUserId ?? null,
    })
  ) {
    return { ok: false, reason: "target_already_claimed" };
  }

  const now = new Date();

  if (input.hqUserId) {
    const [sourceHqLink] = await db
      .select()
      .from(schema.hqMemberLinks)
      .where(
        and(
          eq(schema.hqMemberLinks.allianceId, input.allianceId),
          eq(schema.hqMemberLinks.ashedMemberId, input.sourceAshedMemberId),
          eq(schema.hqMemberLinks.hqUserId, input.hqUserId),
        ),
      )
      .limit(1);

    if (sourceHqLink) {
      if (targetHqLink) {
        await db
          .delete(schema.hqMemberLinks)
          .where(eq(schema.hqMemberLinks.id, sourceHqLink.id));
      } else {
        await db
          .update(schema.hqMemberLinks)
          .set({
            ashedMemberId: input.targetAshedMemberId,
            memberDisplayName: input.gameUserName,
            gameUid: input.gameUid,
            updatedAt: now,
          })
          .where(eq(schema.hqMemberLinks.id, sourceHqLink.id));
      }
    }
  }

  if (input.discordUserId) {
    const sourceDiscordLink = await getDiscordLinkByAllianceAndMember(
      input.allianceId,
      input.sourceAshedMemberId,
    );
    if (
      sourceDiscordLink &&
      sourceDiscordLink.discordUserId === input.discordUserId
    ) {
      if (targetDiscordLink) {
        await deleteDiscordMemberLink(sourceDiscordLink.id);
      } else {
        await db
          .update(schema.discordMemberLinks)
          .set({
            ashedMemberId: input.targetAshedMemberId,
            memberDisplayName: input.gameUserName,
            gameUid: input.gameUid,
            updatedAt: now,
          })
          .where(eq(schema.discordMemberLinks.id, sourceDiscordLink.id));
      }
    }
  }

  await db
    .update(schema.allianceMembers)
    .set({ status: "former", updatedAt: now })
    .where(eq(schema.allianceMembers.id, sourceMember.id));

  await db
    .update(schema.commanderAllianceMemberships)
    .set({ status: "former", leftAt: now, updatedAt: now })
    .where(
      and(
        eq(schema.commanderAllianceMemberships.allianceId, input.allianceId),
        eq(
          schema.commanderAllianceMemberships.ashedMemberId,
          input.sourceAshedMemberId,
        ),
      ),
    );

  await reconcileAllianceMemberForRosterLink({
    allianceId: input.allianceId,
    ashedMemberId: input.targetAshedMemberId,
    gameUserName: input.gameUserName,
  });

  if (input.hqUserId) {
    await syncCommanderIdentityFromMemberLink({
      allianceId: input.allianceId,
      ashedMemberId: input.targetAshedMemberId,
      hqUserId: input.hqUserId,
      gameUid: input.gameUid,
      memberDisplayName: input.gameUserName,
    });
  }

  return { ok: true };
}
