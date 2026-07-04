import "server-only";

import { and, eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { lookupPlayerByUid } from "@/lib/lastwar/player-lookup";

export type MemberPortraitSource = "lastwar" | "hq_avatar" | "upload" | null;

export type ResolvedMemberPortrait = {
  url: string | null;
  source: MemberPortraitSource;
  memberName: string;
};

async function loadAllianceMemberRow(
  allianceId: string,
  ashedMemberId: string,
) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.allianceMembers)
    .where(
      and(
        eq(schema.allianceMembers.allianceId, allianceId),
        eq(schema.allianceMembers.ashedMemberId, ashedMemberId),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function loadLinkedHqAvatar(
  allianceId: string,
  ashedMemberId: string,
): Promise<string | null> {
  const db = getDb();
  const [link] = await db
    .select({ hqUserId: schema.hqMemberLinks.hqUserId })
    .from(schema.hqMemberLinks)
    .where(
      and(
        eq(schema.hqMemberLinks.allianceId, allianceId),
        eq(schema.hqMemberLinks.ashedMemberId, ashedMemberId),
      ),
    )
    .limit(1);

  if (!link?.hqUserId) return null;

  const [user] = await db
    .select({ avatarUrl: schema.hqUsers.avatarUrl })
    .from(schema.hqUsers)
    .where(eq(schema.hqUsers.id, link.hqUserId))
    .limit(1);

  return user?.avatarUrl?.trim() || null;
}

async function resolveGameUid(
  allianceId: string,
  ashedMemberId: string,
  memberRowGameUid: string | null,
): Promise<string | null> {
  if (memberRowGameUid?.trim()) return memberRowGameUid.trim();

  const db = getDb();
  const [link] = await db
    .select({ gameUid: schema.hqMemberLinks.gameUid })
    .from(schema.hqMemberLinks)
    .where(
      and(
        eq(schema.hqMemberLinks.allianceId, allianceId),
        eq(schema.hqMemberLinks.ashedMemberId, ashedMemberId),
      ),
    )
    .limit(1);

  return link?.gameUid?.trim() || null;
}

export async function cacheAllianceMemberPortrait(input: {
  allianceId: string;
  ashedMemberId: string;
  portraitUrl: string;
  portraitSource: Exclude<MemberPortraitSource, null | "hq_avatar">;
}): Promise<void> {
  const db = getDb();
  await db
    .update(schema.allianceMembers)
    .set({
      portraitUrl: input.portraitUrl,
      portraitSource: input.portraitSource,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.allianceMembers.allianceId, input.allianceId),
        eq(schema.allianceMembers.ashedMemberId, input.ashedMemberId),
      ),
    );
}

export async function cacheAllianceMemberPortraitFromGameUid(input: {
  allianceId: string;
  ashedMemberId: string;
  gameUid: string;
  avatarUrl?: string | null;
}): Promise<void> {
  let portraitUrl = input.avatarUrl?.trim() || null;
  if (!portraitUrl) {
    const lookup = await lookupPlayerByUid(input.gameUid);
    if (lookup.ok && lookup.avatarUrl) {
      portraitUrl = lookup.avatarUrl;
    }
  }

  if (!portraitUrl) return;

  await cacheAllianceMemberPortrait({
    allianceId: input.allianceId,
    ashedMemberId: input.ashedMemberId,
    portraitUrl,
    portraitSource: "lastwar",
  });
}

export async function resolveAllianceMemberPortrait(input: {
  allianceId: string;
  ashedMemberId: string;
  forceRefresh?: boolean;
}): Promise<ResolvedMemberPortrait> {
  const member = await loadAllianceMemberRow(
    input.allianceId,
    input.ashedMemberId,
  );
  const memberName = member?.currentName ?? "";

  if (
    !input.forceRefresh &&
    member?.portraitUrl?.trim() &&
    member.portraitSource
  ) {
    return {
      url: member.portraitUrl,
      source: member.portraitSource as MemberPortraitSource,
      memberName,
    };
  }

  const hqAvatar = await loadLinkedHqAvatar(
    input.allianceId,
    input.ashedMemberId,
  );
  if (hqAvatar) {
    return { url: hqAvatar, source: "hq_avatar", memberName };
  }

  const gameUid = await resolveGameUid(
    input.allianceId,
    input.ashedMemberId,
    member?.gameUid ?? null,
  );

  if (gameUid) {
    const lookup = await lookupPlayerByUid(gameUid);
    if (lookup.ok && lookup.avatarUrl) {
      await cacheAllianceMemberPortrait({
        allianceId: input.allianceId,
        ashedMemberId: input.ashedMemberId,
        portraitUrl: lookup.avatarUrl,
        portraitSource: "lastwar",
      });
      return {
        url: lookup.avatarUrl,
        source: "lastwar",
        memberName,
      };
    }
  }

  return { url: null, source: null, memberName };
}

export async function resolveConductorPortrait(input: {
  allianceId: string;
  conductorRecordId: string;
}): Promise<ResolvedMemberPortrait> {
  const db = getDb();
  const [record] = await db
    .select({
      conductorMemberId: schema.trainConductorRecords.conductorMemberId,
      conductorMemberName: schema.trainConductorRecords.conductorMemberName,
    })
    .from(schema.trainConductorRecords)
    .where(
      and(
        eq(schema.trainConductorRecords.id, input.conductorRecordId),
        eq(schema.trainConductorRecords.allianceId, input.allianceId),
      ),
    )
    .limit(1);

  if (!record?.conductorMemberId) {
    return {
      url: null,
      source: null,
      memberName: record?.conductorMemberName ?? "",
    };
  }

  const portrait = await resolveAllianceMemberPortrait({
    allianceId: input.allianceId,
    ashedMemberId: record.conductorMemberId,
  });

  return {
    ...portrait,
    memberName: record.conductorMemberName ?? portrait.memberName,
  };
}
