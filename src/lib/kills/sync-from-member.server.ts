import "server-only";

import { and, eq, gte, lt } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import type { KillsEventSource } from "@/lib/kills/constants";
import {
  getCommanderIdForMember,
  upsertCommanderKills,
} from "@/lib/kills/repository";
import { decideAndMaybeApplyInboundStat } from "@/lib/hq-ashed-stat-sync/inbound";
import { killsStatSyncAdapter } from "@/lib/hq-ashed-stat-sync/kills.adapter";

function parseRecordedDate(value: string): Date {
  const parsed = new Date(`${value}T12:00:00.000Z`);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed;
  }
  const fallback = new Date(value);
  return Number.isNaN(fallback.getTime()) ? new Date() : fallback;
}

async function backfillCommanderKillsEvent(input: {
  commanderId: string;
  total: number;
  previousTotal: number | null;
  source: KillsEventSource;
  allianceId: string;
  createdAt: Date;
}): Promise<boolean> {
  const db = getDb();
  const recordedDate = input.createdAt.toISOString().slice(0, 10);
  const dayStart = new Date(`${recordedDate}T00:00:00.000Z`);
  const dayEnd = new Date(`${recordedDate}T23:59:59.999Z`);
  const [existing] = await db
    .select({ id: schema.commanderKillsEvents.id })
    .from(schema.commanderKillsEvents)
    .where(
      and(
        eq(schema.commanderKillsEvents.commanderId, input.commanderId),
        eq(schema.commanderKillsEvents.total, input.total),
        eq(schema.commanderKillsEvents.source, input.source),
        gte(schema.commanderKillsEvents.createdAt, dayStart),
        lt(schema.commanderKillsEvents.createdAt, dayEnd),
      ),
    )
    .limit(1);

  if (existing) {
    return false;
  }

  await db.insert(schema.commanderKillsEvents).values({
    id: nanoid(),
    commanderId: input.commanderId,
    total: input.total,
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

export async function seedCommanderKillsHistoryFromAshed(input: {
  commanderId: string;
  allianceId: string;
  history?: Array<{ value: number; recorded_date: string }>;
  source?: KillsEventSource;
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
    const created = await backfillCommanderKillsEvent({
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

export async function syncCommanderKillsFromAllianceMember(input: {
  commanderId: string;
  allianceId: string;
  ashedMemberId: string;
  memberName: string;
  total: number | null | undefined;
  source: KillsEventSource;
  hqUserId?: string | null;
}): Promise<boolean> {
  if (input.total == null || !Number.isFinite(input.total) || input.total <= 0) {
    return false;
  }

  if (input.source === "ashed_sync") {
    const decision = await decideAndMaybeApplyInboundStat({
      adapter: killsStatSyncAdapter,
      commanderId: input.commanderId,
      allianceId: input.allianceId,
      ashedMemberId: input.ashedMemberId,
      memberName: input.memberName,
      ashedTotal: Math.round(input.total),
      hqUserId: input.hqUserId,
    });
    return decision === "apply";
  }

  return upsertCommanderKills({
    commanderId: input.commanderId,
    total: Math.round(input.total),
    allianceId: input.allianceId,
    ashedMemberId: input.ashedMemberId,
    memberName: input.memberName,
    source: input.source,
    hqUserId: input.hqUserId ?? null,
  });
}

export async function syncCommanderKillsForMemberIfLinked(input: {
  allianceId: string;
  ashedMemberId: string;
  memberName: string;
  currentKills: number | null | undefined;
  source: KillsEventSource;
  hqUserId?: string | null;
  history?: Array<{ value: number; recorded_date: string }>;
}): Promise<void> {
  const commanderId = await getCommanderIdForMember(
    input.allianceId,
    input.ashedMemberId,
  );
  if (!commanderId) {
    return;
  }

  await seedCommanderKillsHistoryFromAshed({
    commanderId,
    allianceId: input.allianceId,
    history: input.history,
    source: input.source,
  });

  await syncCommanderKillsFromAllianceMember({
    commanderId,
    allianceId: input.allianceId,
    ashedMemberId: input.ashedMemberId,
    memberName: input.memberName,
    total: input.currentKills,
    source: input.source,
    hqUserId: input.hqUserId,
  });
}
