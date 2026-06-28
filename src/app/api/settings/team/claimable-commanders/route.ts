import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { resolveTeamInviteAccess } from "@/lib/native-alliance/team-invites.server";
import { getLinkedMemberIds } from "@/lib/vr/repository";
import { readSessionId } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Roster commanders with no HQ or Discord member link yet — the candidates an
 * officer can issue a commander claim invite for. Never returns the UID
 * (player-uid-privacy.mdc): display name + ashed_member_id only.
 */
export async function GET() {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const access = await resolveTeamInviteAccess(sessionId);
  if (access instanceof NextResponse) {
    return access;
  }

  const db = getDb();
  const [linkedIds, members] = await Promise.all([
    getLinkedMemberIds(access.allianceId),
    db
      .select({
        ashedMemberId: schema.allianceMembers.ashedMemberId,
        currentName: schema.allianceMembers.currentName,
        status: schema.allianceMembers.status,
      })
      .from(schema.allianceMembers)
      .where(eq(schema.allianceMembers.allianceId, access.allianceId))
      .orderBy(asc(schema.allianceMembers.currentName)),
  ]);

  const commanders = members
    .filter(
      (member) =>
        member.status !== "former" && !linkedIds.has(member.ashedMemberId),
    )
    .map((member) => ({
      ashedMemberId: member.ashedMemberId,
      name: member.currentName,
    }));

  return NextResponse.json({ commanders });
}
