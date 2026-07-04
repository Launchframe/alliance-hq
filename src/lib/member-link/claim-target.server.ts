import "server-only";

import { and, eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { findAcceptedClaimInviteForUser } from "@/lib/native-alliance/invites";
import { getHqMemberLinkForUser } from "@/lib/member-link/repository.server";
import { getLinkedMemberIds } from "@/lib/vr/repository";
import { namesMatch } from "@/lib/vr/link-helpers";

export type MemberLinkClaimTargetRecord = {
  ashedMemberId: string;
  commanderName: string;
  previousNames: string[];
};

/**
 * Commander a recipient was invited to claim, if they accepted a claim invite
 * (or claim join code) and have not yet linked. Loads roster names only
 * (never the UID — see player-uid-privacy.mdc).
 */
export async function loadMemberLinkClaimTarget(input: {
  allianceId: string;
  hqUserId: string;
}): Promise<MemberLinkClaimTargetRecord | null> {
  const existingLink = await getHqMemberLinkForUser(
    input.allianceId,
    input.hqUserId,
  );
  if (existingLink) return null;

  const claim = await findAcceptedClaimInviteForUser(
    input.allianceId,
    input.hqUserId,
  );
  if (!claim) return null;

  const db = getDb();
  const [member] = await db
    .select({
      currentName: schema.allianceMembers.currentName,
      previousNamesJson: schema.allianceMembers.previousNamesJson,
      status: schema.allianceMembers.status,
    })
    .from(schema.allianceMembers)
    .where(
      and(
        eq(schema.allianceMembers.allianceId, input.allianceId),
        eq(schema.allianceMembers.ashedMemberId, claim.targetAshedMemberId),
      ),
    )
    .limit(1);

  if (!member || member.status === "former") return null;

  return {
    ashedMemberId: claim.targetAshedMemberId,
    commanderName: member.currentName,
    previousNames: member.previousNamesJson ?? [],
  };
}

/** True when Last War lookup name matches the claim target or a previous name. */
export function claimTargetMatchesLookupName(
  target: Pick<MemberLinkClaimTargetRecord, "commanderName" | "previousNames">,
  gameUserName: string,
): boolean {
  return [target.commanderName, ...target.previousNames].some((name) =>
    namesMatch(name, gameUserName),
  );
}

/**
 * If another already-linked commander shares this in-game name, return that
 * commander's current roster name; otherwise null.
 */
export async function findClaimedNameCollision(input: {
  allianceId: string;
  gameUserName: string;
  targetAshedMemberId: string;
}): Promise<string | null> {
  const db = getDb();
  const [linkedIds, members] = await Promise.all([
    getLinkedMemberIds(input.allianceId),
    db
      .select({
        ashedMemberId: schema.allianceMembers.ashedMemberId,
        currentName: schema.allianceMembers.currentName,
        previousNamesJson: schema.allianceMembers.previousNamesJson,
      })
      .from(schema.allianceMembers)
      .where(eq(schema.allianceMembers.allianceId, input.allianceId)),
  ]);

  for (const member of members) {
    if (member.ashedMemberId === input.targetAshedMemberId) continue;
    if (!linkedIds.has(member.ashedMemberId)) continue;

    const names = [member.currentName, ...(member.previousNamesJson ?? [])];
    if (names.some((name) => namesMatch(name, input.gameUserName))) {
      return member.currentName;
    }
  }

  return null;
}
