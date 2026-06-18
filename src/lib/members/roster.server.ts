import "server-only";

import { and, eq, ne } from "drizzle-orm";
import { nanoid } from "nanoid";

import { base44ListMembers } from "@/lib/base44/fetch";
import type { ParsedConnection } from "@/lib/connectionString";
import { getDb, schema } from "@/lib/db";
import type { AllianceMember } from "@/lib/db/schema";
import { formatAshedMemberRankValue } from "@/lib/members/alliance-rank";
import { normalizedRankFromAshedMember } from "@/lib/members/roster.shared";

export {
  allianceMemberRowToAshedMember,
  normalizedRankFromAshedMember,
  readAshedRankRawFromMember,
} from "@/lib/members/roster.shared";

export async function resolveHqAllianceId(
  sessionAllianceId: string | null | undefined,
  ashedAllianceId: string,
): Promise<string> {
  if (sessionAllianceId) {
    return sessionAllianceId;
  }

  const db = getDb();
  const [row] = await db
    .select({ id: schema.alliances.id })
    .from(schema.alliances)
    .where(eq(schema.alliances.ashedAllianceId, ashedAllianceId))
    .limit(1);

  if (!row) {
    throw new Error(
      "Alliance is not linked in HQ. Reconnect from Settings before syncing members.",
    );
  }

  return row.id;
}

export async function syncAllianceMembersFromAshed(input: {
  hqAllianceId: string;
  ashedAllianceId: string;
  connection: ParsedConnection;
}): Promise<{ synced: number }> {
  const members = await base44ListMembers(input.connection, input.ashedAllianceId);
  const now = new Date();
  const db = getDb();
  let synced = 0;

  for (const member of members) {
    const ashedMemberId = member.id;
    if (!ashedMemberId) continue;

    const normalized = normalizedRankFromAshedMember(
      member as unknown as Record<string, unknown>,
    );

    await db
      .insert(schema.allianceMembers)
      .values({
        id: nanoid(),
        allianceId: input.hqAllianceId,
        ashedMemberId,
        ashedAllianceId: input.ashedAllianceId,
        currentName: member.current_name,
        previousNamesJson: member.previous_names ?? [],
        status: member.status ?? "active",
        allianceRank: normalized.allianceRank,
        allianceRankTitle: normalized.allianceRankTitle,
        ashedRankRaw: normalized.ashedRankRaw,
        syncedAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          schema.allianceMembers.allianceId,
          schema.allianceMembers.ashedMemberId,
        ],
        set: {
          ashedAllianceId: input.ashedAllianceId,
          currentName: member.current_name,
          previousNamesJson: member.previous_names ?? [],
          status: member.status ?? "active",
          allianceRank: normalized.allianceRank,
          allianceRankTitle: normalized.allianceRankTitle,
          ashedRankRaw: normalized.ashedRankRaw,
          syncedAt: now,
          updatedAt: now,
        },
      });

    synced += 1;
  }

  return { synced };
}

export async function listAllianceMembers(
  hqAllianceId: string,
): Promise<AllianceMember[]> {
  const db = getDb();
  return db
    .select()
    .from(schema.allianceMembers)
    .where(eq(schema.allianceMembers.allianceId, hqAllianceId));
}

export async function listActiveAllianceMembersForPool(
  hqAllianceId: string,
): Promise<AllianceMember[]> {
  const db = getDb();
  return db
    .select()
    .from(schema.allianceMembers)
    .where(
      and(
        eq(schema.allianceMembers.allianceId, hqAllianceId),
        ne(schema.allianceMembers.status, "former"),
      ),
    );
}

export async function listActiveAllianceMembersForPoolWithSync(input: {
  hqAllianceId: string;
  ashedAllianceId: string;
  connection: ParsedConnection;
}): Promise<AllianceMember[]> {
  let members = await listActiveAllianceMembersForPool(input.hqAllianceId);
  if (members.length === 0) {
    await syncAllianceMembersFromAshed(input);
    members = await listActiveAllianceMembersForPool(input.hqAllianceId);
  }
  return members;
}

export async function setAllianceMemberRank(input: {
  hqAllianceId: string;
  ashedMemberId: string;
  allianceRank: number;
  allianceRankTitle?: string | null;
}): Promise<void> {
  const db = getDb();
  const ashedRankRaw = formatAshedMemberRankValue(
    input.allianceRank,
    input.allianceRankTitle,
  );
  const now = new Date();

  await db
    .update(schema.allianceMembers)
    .set({
      allianceRank: input.allianceRank,
      allianceRankTitle: input.allianceRankTitle?.trim() || null,
      ashedRankRaw,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.allianceMembers.allianceId, input.hqAllianceId),
        eq(schema.allianceMembers.ashedMemberId, input.ashedMemberId),
      ),
    );
}

export async function clearAllianceMemberRank(input: {
  hqAllianceId: string;
  ashedMemberId: string;
}): Promise<void> {
  const db = getDb();
  await db
    .update(schema.allianceMembers)
    .set({
      allianceRank: null,
      allianceRankTitle: null,
      ashedRankRaw: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.allianceMembers.allianceId, input.hqAllianceId),
        eq(schema.allianceMembers.ashedMemberId, input.ashedMemberId),
      ),
    );
}
