import "server-only";

import { and, eq, ne } from "drizzle-orm";
import { nanoid } from "nanoid";

import { base44ListMemberRecords } from "@/lib/base44/fetch";
import type { ParsedConnection } from "@/lib/connectionString";
import { getDb, schema } from "@/lib/db";
import type { AllianceMember } from "@/lib/db/schema";
import type { AshedMemberRecord } from "@/lib/members/ashed-member-record";
import { formatAshedMemberRankValue } from "@/lib/members/alliance-rank";
import { seedMemberStatHistoriesFromAshed } from "@/lib/members/member-stat-history.server";
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
  const members = await base44ListMemberRecords(input.connection, input.ashedAllianceId);
  const now = new Date();
  const db = getDb();
  let synced = 0;

  for (const member of members) {
    const ashedMemberId = member.id;
    if (!ashedMemberId) continue;

    const record = member as AshedMemberRecord;
    const normalized = normalizedRankFromAshedMember(
      member as unknown as Record<string, unknown>,
    );
    const ashedCreatedAt = parseAshedTimestamp(record.created_date);
    const ashedUpdatedAt = parseAshedTimestamp(record.updated_date);

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
        memberLevel:
          typeof record.level === "number" ? Math.round(record.level) : null,
        joinDate: record.join_date ?? null,
        profession: record.profession?.toString() ?? null,
        professionalLevel:
          typeof record.professional_level === "number"
            ? record.professional_level
            : null,
        powerLevel: record.power_level ?? null,
        currentKills:
          typeof record.current_kills === "number" ? record.current_kills : null,
        currentTotalHeroPower:
          typeof record.current_total_hero_power === "number"
            ? record.current_total_hero_power
            : null,
        notes: record.notes ?? null,
        timezone: record.timezone ?? null,
        recordedDate: record.recorded_date ?? null,
        ashedCreatedAt,
        ashedUpdatedAt,
        currentSquadPowerJson: record.current_squad_power ?? null,
        squadPowerSnapshotsJson: record.squad_power_snapshots ?? null,
        isSample: record.is_sample ?? null,
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
          memberLevel:
            typeof record.level === "number" ? Math.round(record.level) : null,
          joinDate: record.join_date ?? null,
          profession: record.profession?.toString() ?? null,
          professionalLevel:
            typeof record.professional_level === "number"
              ? record.professional_level
              : null,
          powerLevel: record.power_level ?? null,
          currentKills:
            typeof record.current_kills === "number"
              ? record.current_kills
              : null,
          currentTotalHeroPower:
            typeof record.current_total_hero_power === "number"
              ? record.current_total_hero_power
              : null,
          notes: record.notes ?? null,
          timezone: record.timezone ?? null,
          recordedDate: record.recorded_date ?? null,
          ashedCreatedAt,
          ashedUpdatedAt,
          currentSquadPowerJson: record.current_squad_power ?? null,
          squadPowerSnapshotsJson: record.squad_power_snapshots ?? null,
          isSample: record.is_sample ?? null,
          syncedAt: now,
          updatedAt: now,
        },
      });

    await seedMemberStatHistoriesFromAshed({
      allianceId: input.hqAllianceId,
      ashedMemberId,
      memberName: member.current_name,
      levelHistory: record.level_history,
      powerLevelHistory: record.power_level_history,
      professionalLevelHistory: record.professional_level_history,
      totalHeroPowerHistory: record.total_hero_power_history,
    });

    synced += 1;
  }

  return { synced };
}

function parseAshedTimestamp(value: string | null | undefined): Date | null {
  if (!value?.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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
