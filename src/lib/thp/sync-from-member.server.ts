import "server-only";

import { and, eq, gte, lt } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import type { ThpEventSource } from "@/lib/thp/constants";
import { resolveThpTotalFromSnapshot } from "@/lib/commanders/power-stats.shared";
import type { CommanderAshedStats } from "@/lib/commanders/commander-ashed-stats.shared";
import {
  getCommanderIdForMember,
  upsertCommanderThp,
} from "@/lib/thp/repository";

function parseRecordedDate(value: string): Date {
  const parsed = new Date(`${value}T12:00:00.000Z`);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed;
  }
  const fallback = new Date(value);
  return Number.isNaN(fallback.getTime()) ? new Date() : fallback;
}

async function backfillCommanderThpEvent(input: {
  commanderId: string;
  total: number;
  previousTotal: number | null;
  source: ThpEventSource;
  allianceId: string;
  createdAt: Date;
}): Promise<boolean> {
  const db = getDb();
  const recordedDate = input.createdAt.toISOString().slice(0, 10);
  const dayStart = new Date(`${recordedDate}T00:00:00.000Z`);
  const dayEnd = new Date(`${recordedDate}T23:59:59.999Z`);
  const [existing] = await db
    .select({ id: schema.commanderThpEvents.id })
    .from(schema.commanderThpEvents)
    .where(
      and(
        eq(schema.commanderThpEvents.commanderId, input.commanderId),
        eq(schema.commanderThpEvents.total, input.total),
        eq(schema.commanderThpEvents.source, input.source),
        gte(schema.commanderThpEvents.createdAt, dayStart),
        lt(schema.commanderThpEvents.createdAt, dayEnd),
      ),
    )
    .limit(1);

  if (existing) {
    return false;
  }

  await db.insert(schema.commanderThpEvents).values({
    id: nanoid(),
    commanderId: input.commanderId,
    total: input.total,
    breakdown: null,
    previousTotal: input.previousTotal,
    source: input.source,
    allianceId: input.allianceId,
    reportedByHqUserId: null,
    reportedByDiscordUserId: null,
    ashedSyncedAt: input.source === "ashed_sync" ? input.createdAt : null,
    discardedAt: null,
    createdAt: input.createdAt,
  });
  return true;
}

async function backfillCommanderPowerLevelEvent(input: {
  commanderId: string;
  allianceId: string;
  value: string;
  recordedDate: string;
  source: ThpEventSource;
  createdAt: Date;
}): Promise<boolean> {
  const db = getDb();
  const [existing] = await db
    .select({ id: schema.commanderPowerLevelEvents.id })
    .from(schema.commanderPowerLevelEvents)
    .where(
      and(
        eq(schema.commanderPowerLevelEvents.commanderId, input.commanderId),
        eq(schema.commanderPowerLevelEvents.allianceId, input.allianceId),
        eq(schema.commanderPowerLevelEvents.recordedDate, input.recordedDate),
        eq(schema.commanderPowerLevelEvents.value, input.value),
      ),
    )
    .limit(1);

  if (existing) {
    return false;
  }

  await db.insert(schema.commanderPowerLevelEvents).values({
    id: nanoid(),
    commanderId: input.commanderId,
    allianceId: input.allianceId,
    value: input.value,
    recordedDate: input.recordedDate,
    source: input.source,
    recordedAt: input.createdAt,
    recordedByHqUserId: null,
  });
  return true;
}

export async function syncCommanderThpFromAllianceMember(input: {
  commanderId: string;
  allianceId: string;
  ashedMemberId: string;
  memberName: string;
  total: number | null | undefined;
  source: ThpEventSource;
  hqUserId?: string | null;
}): Promise<boolean> {
  if (input.total == null || !Number.isFinite(input.total) || input.total <= 0) {
    return false;
  }

  // Blind ashed_sync must respect monotonic dual-write policy.
  if (input.source === "ashed_sync") {
    const { decideAndMaybeApplyInboundStat } = await import(
      "@/lib/hq-ashed-stat-sync/inbound"
    );
    const { thpStatSyncAdapter } = await import(
      "@/lib/hq-ashed-stat-sync/thp.adapter"
    );
    const decision = await decideAndMaybeApplyInboundStat({
      adapter: thpStatSyncAdapter,
      commanderId: input.commanderId,
      allianceId: input.allianceId,
      ashedMemberId: input.ashedMemberId,
      memberName: input.memberName,
      ashedTotal: Math.round(input.total),
      hqUserId: input.hqUserId,
    });
    return decision === "apply";
  }

  return upsertCommanderThp({
    commanderId: input.commanderId,
    total: Math.round(input.total),
    breakdown: null,
    allianceId: input.allianceId,
    ashedMemberId: input.ashedMemberId,
    memberName: input.memberName,
    source: input.source,
    hqUserId: input.hqUserId ?? null,
  });
}

export async function syncCommanderThpAfterAshedStats(input: {
  commanderId: string;
  allianceId: string;
  ashedMemberId: string;
  memberName: string;
  ashedStats: CommanderAshedStats | null | undefined;
  source: ThpEventSource;
  hqUserId?: string | null;
}): Promise<boolean> {
  const total = resolveThpTotalFromSnapshot(input.ashedStats ?? {});
  if (total == null) {
    return false;
  }
  return syncCommanderThpFromAllianceMember({
    commanderId: input.commanderId,
    allianceId: input.allianceId,
    ashedMemberId: input.ashedMemberId,
    memberName: input.memberName,
    total,
    source: input.source,
    hqUserId: input.hqUserId,
  });
}

export async function seedCommanderThpHistoryFromAshed(input: {
  commanderId: string;
  allianceId: string;
  history?: Array<{ value: number; recorded_date: string }>;
  source?: ThpEventSource;
}): Promise<number> {
  const points = [...(input.history ?? [])].sort((a, b) =>
    a.recorded_date.localeCompare(b.recorded_date),
  );
  if (points.length === 0) {
    return 0;
  }

  const source = input.source ?? "ashed_sync";
  let inserted = 0;
  let previousTotal: number | null = null;

  for (const point of points) {
    if (!Number.isFinite(point.value) || point.value <= 0) {
      continue;
    }
    const created = await backfillCommanderThpEvent({
      commanderId: input.commanderId,
      total: Math.round(point.value),
      previousTotal,
      source,
      allianceId: input.allianceId,
      createdAt: parseRecordedDate(point.recorded_date),
    });
    if (created) {
      inserted += 1;
    }
    previousTotal = Math.round(point.value);
  }

  return inserted;
}

export async function seedCommanderPowerLevelHistoryFromAshed(input: {
  commanderId: string;
  allianceId: string;
  history?: Array<{ value: string; recorded_date: string }>;
  source?: ThpEventSource;
}): Promise<number> {
  const points = [...(input.history ?? [])].sort((a, b) =>
    a.recorded_date.localeCompare(b.recorded_date),
  );
  if (points.length === 0) {
    return 0;
  }

  const source = input.source ?? "ashed_sync";
  let inserted = 0;

  for (const point of points) {
    const value = point.value?.trim();
    if (!value) continue;
    const created = await backfillCommanderPowerLevelEvent({
      commanderId: input.commanderId,
      allianceId: input.allianceId,
      value,
      recordedDate: point.recorded_date,
      source,
      createdAt: parseRecordedDate(point.recorded_date),
    });
    if (created) {
      inserted += 1;
    }
  }

  return inserted;
}

export async function syncCommanderThpForMemberIfLinked(input: {
  allianceId: string;
  ashedMemberId: string;
  memberName: string;
  ashedStats: CommanderAshedStats | null | undefined;
  source: ThpEventSource;
  hqUserId?: string | null;
  history?: Array<{ value: number; recorded_date: string }>;
  powerLevelHistory?: Array<{ value: string; recorded_date: string }>;
}): Promise<void> {
  const commanderId = await getCommanderIdForMember(
    input.allianceId,
    input.ashedMemberId,
  );
  if (!commanderId) {
    return;
  }

  await seedCommanderThpHistoryFromAshed({
    commanderId,
    allianceId: input.allianceId,
    history: input.history,
    source: input.source,
  });
  await seedCommanderPowerLevelHistoryFromAshed({
    commanderId,
    allianceId: input.allianceId,
    history: input.powerLevelHistory,
    source: input.source,
  });

  await syncCommanderThpAfterAshedStats({
    commanderId,
    allianceId: input.allianceId,
    ashedMemberId: input.ashedMemberId,
    memberName: input.memberName,
    ashedStats: input.ashedStats,
    source: input.source,
    hqUserId: input.hqUserId,
  });
}
