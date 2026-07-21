import "server-only";

import { and, desc, eq, isNull } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import {
  clearInboundStatConflict,
  upsertInboundStatConflict,
} from "@/lib/hq-ashed-stat-sync/conflicts.server";
import {
  decideInboundStatApply,
  isProtectedHqStatSource,
} from "@/lib/hq-ashed-stat-sync/policy";
import type { InboundStatDecision } from "@/lib/hq-ashed-stat-sync/policy";
import type { StatSyncAdapter } from "@/lib/hq-ashed-stat-sync/types";

export async function loadLatestNonDiscardedEventMeta(
  table: "thp" | "kills" | "level",
  commanderId: string,
): Promise<{
  source: string | null;
  eventId: string | null;
  ashedSyncedAt: Date | null;
  total: number | null;
  createdAt: Date | null;
}> {
  const db = getDb();
  if (table === "thp") {
    const [row] = await db
      .select({
        source: schema.commanderThpEvents.source,
        eventId: schema.commanderThpEvents.id,
        ashedSyncedAt: schema.commanderThpEvents.ashedSyncedAt,
        total: schema.commanderThpEvents.total,
        createdAt: schema.commanderThpEvents.createdAt,
      })
      .from(schema.commanderThpEvents)
      .where(
        and(
          eq(schema.commanderThpEvents.commanderId, commanderId),
          isNull(schema.commanderThpEvents.discardedAt),
        ),
      )
      .orderBy(desc(schema.commanderThpEvents.createdAt))
      .limit(1);
    return {
      source: row?.source ?? null,
      eventId: row?.eventId ?? null,
      ashedSyncedAt: row?.ashedSyncedAt ?? null,
      total: row?.total ?? null,
      createdAt: row?.createdAt ?? null,
    };
  }

  if (table === "level") {
    const [row] = await db
      .select({
        source: schema.commanderLevelEvents.source,
        eventId: schema.commanderLevelEvents.id,
        ashedSyncedAt: schema.commanderLevelEvents.ashedSyncedAt,
        total: schema.commanderLevelEvents.total,
        createdAt: schema.commanderLevelEvents.createdAt,
      })
      .from(schema.commanderLevelEvents)
      .where(
        and(
          eq(schema.commanderLevelEvents.commanderId, commanderId),
          isNull(schema.commanderLevelEvents.discardedAt),
        ),
      )
      .orderBy(desc(schema.commanderLevelEvents.createdAt))
      .limit(1);
    return {
      source: row?.source ?? null,
      eventId: row?.eventId ?? null,
      ashedSyncedAt: row?.ashedSyncedAt ?? null,
      total: row?.total ?? null,
      createdAt: row?.createdAt ?? null,
    };
  }

  const [row] = await db
    .select({
      source: schema.commanderKillsEvents.source,
      eventId: schema.commanderKillsEvents.id,
      ashedSyncedAt: schema.commanderKillsEvents.ashedSyncedAt,
      total: schema.commanderKillsEvents.total,
      createdAt: schema.commanderKillsEvents.createdAt,
    })
    .from(schema.commanderKillsEvents)
    .where(
      and(
        eq(schema.commanderKillsEvents.commanderId, commanderId),
        isNull(schema.commanderKillsEvents.discardedAt),
      ),
    )
    .orderBy(desc(schema.commanderKillsEvents.createdAt))
    .limit(1);
  return {
    source: row?.source ?? null,
    eventId: row?.eventId ?? null,
    ashedSyncedAt: row?.ashedSyncedAt ?? null,
    total: row?.total ?? null,
    createdAt: row?.createdAt ?? null,
  };
}

/**
 * Decide whether Ashed roster sync may overwrite HQ for a monotonic stat.
 * Callers must only call adapter.applyAshedOnHq when decision === "apply".
 * Conflicts are persisted for officer review at `/stat-sync`.
 */
export async function decideAndMaybeApplyInboundStat(input: {
  adapter: StatSyncAdapter;
  commanderId: string;
  allianceId: string;
  ashedMemberId: string;
  memberName: string;
  ashedTotal: number;
  ashedRecordedAt?: Date | null;
  hqUserId?: string | null;
}): Promise<InboundStatDecision> {
  const hq = await input.adapter.getHqCurrent(input.commanderId);
  const decision = decideInboundStatApply({
    hqTotal: hq.total,
    hqLatestSource: hq.latestSource,
    hqPendingUnsyncedSelfReport: hq.pendingUnsyncedSelfReport,
    hqUpdatedAt: hq.updatedAt,
    ashedTotal: input.ashedTotal,
    ashedRecordedAt: input.ashedRecordedAt ?? null,
  });

  if (decision === "apply") {
    await input.adapter.applyAshedOnHq({
      commanderId: input.commanderId,
      allianceId: input.allianceId,
      ashedMemberId: input.ashedMemberId,
      memberName: input.memberName,
      total: Math.round(input.ashedTotal),
      source: "ashed_sync",
      hqUserId: input.hqUserId,
    });
    await clearInboundStatConflict({
      allianceId: input.allianceId,
      stat: input.adapter.stat,
      commanderId: input.commanderId,
    });
  } else if (decision === "conflict" && hq.total != null) {
    await upsertInboundStatConflict({
      allianceId: input.allianceId,
      stat: input.adapter.stat,
      commanderId: input.commanderId,
      ashedMemberId: input.ashedMemberId,
      memberName: input.memberName,
      hqTotal: hq.total,
      ashedTotal: Math.round(input.ashedTotal),
      hqSource: hq.latestSource,
      hqEventId: hq.latestEventId,
    });
  } else if (decision === "noop") {
    await clearInboundStatConflict({
      allianceId: input.allianceId,
      stat: input.adapter.stat,
      commanderId: input.commanderId,
    });
  }

  return decision;
}

export function pendingUnsyncedFromMeta(meta: {
  source: string | null;
  ashedSyncedAt: Date | null;
}): boolean {
  return isProtectedHqStatSource(meta.source) && meta.ashedSyncedAt == null;
}
