import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { getAshedAllianceIdIfLinked } from "@/lib/alliance/ashed-write-guard";
import type { ParsedConnection } from "@/lib/connectionString";
import { getDb, schema } from "@/lib/db";
import { syncMemberNameToAshed } from "@/lib/members/member-name-sync.server";
import { linkDiscordMember } from "@/lib/vr/repository";

export type PendingRosterLinkRequestRow = {
  id: string;
  origin: string;
  reportedName: string;
  gameUserName: string;
  gameUidLast4: string;
  gameServerNumber: number | null;
  status: string;
  createdAt: Date;
  discordUsername: string | null;
  requesterHqUserId: string;
  suggestedTargetAshedMemberId: string | null;
  suggestionMethod: string | null;
};

export async function listPendingRosterLinkRequests(
  allianceId: string,
): Promise<PendingRosterLinkRequestRow[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.hqRosterLinkRequests)
    .where(
      and(
        eq(schema.hqRosterLinkRequests.allianceId, allianceId),
        eq(schema.hqRosterLinkRequests.status, "pending"),
      ),
    )
    .orderBy(desc(schema.hqRosterLinkRequests.createdAt));

  return rows.map((row) => ({
    id: row.id,
    origin: row.origin,
    reportedName: row.reportedName,
    gameUserName: row.gameUserName,
    gameUidLast4: row.gameUid.slice(-4),
    gameServerNumber: row.gameServerNumber,
    status: row.status,
    createdAt: row.createdAt,
    discordUsername: row.discordUsername,
    requesterHqUserId: row.hqUserId,
    suggestedTargetAshedMemberId: row.suggestedTargetAshedMemberId,
    suggestionMethod: row.suggestionMethod,
  }));
}

export async function reconcileAllianceMemberForRosterLink(input: {
  allianceId: string;
  ashedMemberId: string;
  gameUserName: string;
  ashedConnection?: ParsedConnection | null;
}): Promise<void> {
  const db = getDb();
  const [existing] = await db
    .select()
    .from(schema.allianceMembers)
    .where(
      and(
        eq(schema.allianceMembers.allianceId, input.allianceId),
        eq(schema.allianceMembers.ashedMemberId, input.ashedMemberId),
      ),
    )
    .limit(1);

  if (!existing) {
    throw new Error(`Matched member not found: ${input.ashedMemberId}`);
  }

  const name = input.gameUserName.trim();
  const previousNames = existing.previousNamesJson ?? [];
  const nameChanged = existing.currentName !== name;
  const nextPreviousNames =
    nameChanged && !previousNames.includes(existing.currentName)
      ? [...previousNames, existing.currentName]
      : previousNames;

  const now = new Date();
  await db
    .update(schema.allianceMembers)
    .set({
      currentName: name,
      previousNamesJson: nextPreviousNames,
      syncedAt: now,
      updatedAt: now,
    })
    .where(eq(schema.allianceMembers.id, existing.id));

  const linkedAshedId = await getAshedAllianceIdIfLinked(input.allianceId);
  if (nameChanged && linkedAshedId && input.ashedConnection) {
    try {
      await syncMemberNameToAshed(
        input.ashedConnection,
        existing.ashedMemberId,
        name,
      );
    } catch (error) {
      console.error("[roster-link-resolve] Ashed name sync failed", error);
    }
  }
}

export async function bindDiscordRosterLinkRequest(input: {
  allianceId: string;
  discordUserId: string;
  discordUsername?: string | null;
  ashedMemberId: string;
  memberDisplayName: string;
  gameUid: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const linked = await linkDiscordMember({
    allianceId: input.allianceId,
    discordUserId: input.discordUserId,
    discordUsername: input.discordUsername,
    ashedMemberId: input.ashedMemberId,
    memberDisplayName: input.memberDisplayName,
    gameUid: input.gameUid,
  });

  if (!linked.ok) {
    return { ok: false, reason: linked.reason };
  }

  return { ok: true };
}
