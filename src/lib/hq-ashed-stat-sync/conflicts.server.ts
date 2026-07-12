import "server-only";

import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import type {
  MonotonicStatId,
  StatSyncReviewRow,
} from "@/lib/hq-ashed-stat-sync/types";

export async function upsertInboundStatConflict(input: {
  allianceId: string;
  stat: MonotonicStatId;
  commanderId: string;
  ashedMemberId: string;
  memberName: string;
  hqTotal: number;
  ashedTotal: number;
  hqSource: string | null;
  hqEventId: string | null;
}): Promise<void> {
  const db = getDb();
  const now = new Date();
  await db
    .insert(schema.hqAshedStatSyncConflicts)
    .values({
      id: nanoid(),
      allianceId: input.allianceId,
      stat: input.stat,
      commanderId: input.commanderId,
      ashedMemberId: input.ashedMemberId,
      memberName: input.memberName,
      hqTotal: Math.round(input.hqTotal),
      ashedTotal: Math.round(input.ashedTotal),
      hqSource: input.hqSource,
      hqEventId: input.hqEventId,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        schema.hqAshedStatSyncConflicts.allianceId,
        schema.hqAshedStatSyncConflicts.stat,
        schema.hqAshedStatSyncConflicts.commanderId,
      ],
      set: {
        ashedMemberId: input.ashedMemberId,
        memberName: input.memberName,
        hqTotal: Math.round(input.hqTotal),
        ashedTotal: Math.round(input.ashedTotal),
        hqSource: input.hqSource,
        hqEventId: input.hqEventId,
        updatedAt: now,
      },
    });
}

export async function clearInboundStatConflict(input: {
  allianceId: string;
  stat: MonotonicStatId;
  commanderId: string;
}): Promise<void> {
  const db = getDb();
  await db
    .delete(schema.hqAshedStatSyncConflicts)
    .where(
      and(
        eq(schema.hqAshedStatSyncConflicts.allianceId, input.allianceId),
        eq(schema.hqAshedStatSyncConflicts.stat, input.stat),
        eq(schema.hqAshedStatSyncConflicts.commanderId, input.commanderId),
      ),
    );
}

export async function listInboundStatConflicts(
  allianceId: string,
  stat: MonotonicStatId,
): Promise<StatSyncReviewRow[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.hqAshedStatSyncConflicts)
    .where(
      and(
        eq(schema.hqAshedStatSyncConflicts.allianceId, allianceId),
        eq(schema.hqAshedStatSyncConflicts.stat, stat),
      ),
    );

  return rows.map((row) => ({
    stat: row.stat as MonotonicStatId,
    commanderId: row.commanderId,
    ashedMemberId: row.ashedMemberId,
    memberName: row.memberName,
    hqTotal: row.hqTotal,
    ashedTotal: row.ashedTotal,
    hqSource: row.hqSource,
    hqUpdatedAt: row.updatedAt.toISOString(),
    eventId: row.hqEventId,
    reason: "inbound_conflict" as const,
  }));
}
