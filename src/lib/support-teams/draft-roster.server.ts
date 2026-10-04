import "server-only";

import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { schema } from "@/lib/db";
import type { SupportTransaction } from "./repository.server";
import type { SupportRosterMember } from "./types.shared";

export async function withDraftStintTokens(db: Pick<SupportTransaction, "select">, allianceId: string, roster: SupportRosterMember[]): Promise<SupportRosterMember[]> {
  const tenures = await db.select({ id: schema.memberAllianceTenure.id, memberId: schema.memberAllianceTenure.ashedMemberId, joinedAt: schema.memberAllianceTenure.joinedAt, leftAt: schema.memberAllianceTenure.leftAt }).from(schema.memberAllianceTenure).where(eq(schema.memberAllianceTenure.allianceId, allianceId));
  const canonical = await db.select({ id: schema.commanderAllianceMemberships.id, memberId: schema.commanderAllianceMemberships.ashedMemberId, joinedAt: schema.commanderAllianceMemberships.joinedAt, leftAt: schema.commanderAllianceMemberships.leftAt, status: schema.commanderAllianceMemberships.status }).from(schema.commanderAllianceMemberships).where(eq(schema.commanderAllianceMemberships.allianceId, allianceId));
  const members = await db.select({ id: schema.allianceMembers.id, memberId: schema.allianceMembers.ashedMemberId, joinDate: schema.allianceMembers.joinDate, createdAt: schema.allianceMembers.createdAt }).from(schema.allianceMembers).where(eq(schema.allianceMembers.allianceId, allianceId));
  return roster.map((member) => ({ ...member, draftStintToken: createHash("sha256").update(JSON.stringify([members.filter((m) => m.memberId === member.id).sort((a, b) => a.id.localeCompare(b.id)), tenures.filter((m) => m.memberId === member.id).sort((a, b) => a.id.localeCompare(b.id)), canonical.filter((m) => m.memberId === member.id).sort((a, b) => a.id.localeCompare(b.id))])).digest("hex") }));
}
