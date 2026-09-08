import "server-only";

import { createHash } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { schema } from "@/lib/db";
import type { SupportTransaction } from "./repository.server";
import type { SupportRosterMember } from "./types.shared";

export async function withProposalVoters(db: Pick<SupportTransaction, "select">, allianceId: string, roster: SupportRosterMember[]): Promise<SupportRosterMember[]> {
  const legacy = await db.select({ proofKey: sql<string | null>`md5(nullif(${schema.hqMemberLinks.gameUid}, ''))`, id: schema.hqMemberLinks.id, linkedAt: schema.hqMemberLinks.linkedAt, memberId: schema.hqMemberLinks.ashedMemberId, principalId: schema.hqMemberLinks.hqUserId }).from(schema.hqMemberLinks).where(eq(schema.hqMemberLinks.allianceId, allianceId));
  const canonical = await db.select({ proofKey: sql<string | null>`md5(nullif(${schema.commanders.gameUid}, ''))`, id: schema.hqUserCommanders.id, linkedAt: schema.hqUserCommanders.linkedAt, memberId: schema.commanderAllianceMemberships.ashedMemberId, principalId: schema.hqUserCommanders.hqUserId }).from(schema.hqUserCommanders)
    .innerJoin(schema.commanders, eq(schema.commanders.id, schema.hqUserCommanders.commanderId))
    .innerJoin(schema.commanderAllianceMemberships, eq(schema.commanderAllianceMemberships.commanderId, schema.hqUserCommanders.commanderId))
    .where(and(eq(schema.commanderAllianceMemberships.allianceId, allianceId), eq(schema.commanderAllianceMemberships.status, "active"), isNull(schema.commanderAllianceMemberships.leftAt)));
  const discord = await db.select({ proofKey: sql<string | null>`md5(nullif(${schema.discordMemberLinks.gameUid}, ''))`, id: schema.discordMemberLinks.id, linkedAt: schema.discordMemberLinks.linkedAt, hqLinkedAt: schema.discordHqLinks.linkedAt, memberId: schema.discordMemberLinks.ashedMemberId, principalId: schema.discordHqLinks.hqUserId, discordId: schema.discordMemberLinks.discordUserId }).from(schema.discordMemberLinks)
    .leftJoin(schema.discordHqLinks, eq(schema.discordHqLinks.discordUserId, schema.discordMemberLinks.discordUserId)).where(eq(schema.discordMemberLinks.allianceId, allianceId));
  const bindings = [...legacy, ...canonical, ...discord.map((row) => ({ ...row, principalId: row.principalId ?? `discord:${row.discordId}` }))];
  return roster.map((member) => {
    const direct = bindings.filter((row) => row.memberId === member.id);
    const proofs = new Set(direct.flatMap((row) => row.proofKey ? [row.proofKey] : []));
    const current = bindings.filter((row) => row.memberId === member.id || (row.proofKey && proofs.has(row.proofKey))).sort((a, b) => a.id.localeCompare(b.id));
    return { ...member, proposalVoterIds: [...new Set(current.map((row) => row.principalId))].sort(), proposalIdentityToken: createHash("sha256").update(JSON.stringify(current)).digest("hex") };
  });
}
