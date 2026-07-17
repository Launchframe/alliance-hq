import "server-only";

import { and, eq, gte, lt } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import type { LevelEventSource } from "@/lib/member-level/constants";
import {
  getCommanderIdForMember,
  upsertCommanderLevel,
} from "@/lib/member-level/repository";
import {
  loadLatestNonDiscardedEventMeta,
  decideAndMaybeApplyInboundStat,
} from "@/lib/hq-ashed-stat-sync/inbound";
import { levelStatSyncAdapter } from "@/lib/hq-ashed-stat-sync/level.adapter";
import {
  clampMemberHqLevel,
  MAX_MEMBER_HQ_LEVEL,
  normalizeMemberHqLevel,
} from "@/lib/members/member-level.shared";

function parseRecordedDate(value: string): Date {
  const parsed = new Date(`${value}T12:00:00.000Z`);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed;
  }
  const fallback = new Date(value);
  return Number.isNaN(fallback.getTime()) ? new Date() : fallback;
}

async function backfillCommanderLevelEvent(input: {
  commanderId: string;
  total: number;
  previousTotal: number | null;
  source: LevelEventSource;
  allianceId: string;
  createdAt: Date;
}): Promise<boolean> {
  const db = getDb();
  const recordedDate = input.createdAt.toISOString().slice(0, 10);
  const dayStart = new Date(`${recordedDate}T00:00:00.000Z`);
  const dayEnd = new Date(`${recordedDate}T23:59:59.999Z`);
  const [existing] = await db
    .select({ id: schema.commanderLevelEvents.id })
    .from(schema.commanderLevelEvents)
    .where(
      and(
        eq(schema.commanderLevelEvents.commanderId, input.commanderId),
        eq(schema.commanderLevelEvents.total, input.total),
        eq(schema.commanderLevelEvents.source, input.source),
        gte(schema.commanderLevelEvents.createdAt, dayStart),
        lt(schema.commanderLevelEvents.createdAt, dayEnd),
      ),
    )
    .limit(1);

  if (existing) {
    return false;
  }

  await db.insert(schema.commanderLevelEvents).values({
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

export async function seedCommanderLevelHistoryFromAshed(input: {
  commanderId: string;
  allianceId: string;
  history?: Array<{ value: number; recorded_date: string }>;
  source?: LevelEventSource;
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
    const total = normalizeMemberHqLevel(point.value);
    if (total == null) continue;
    const created = await backfillCommanderLevelEvent({
      commanderId: input.commanderId,
      total,
      previousTotal,
      source,
      allianceId: input.allianceId,
      createdAt: parseRecordedDate(point.recorded_date),
    });
    if (created) {
      inserted += 1;
    }
    previousTotal = total;
  }

  return inserted;
}

export async function syncCommanderLevelFromAllianceMember(input: {
  commanderId: string;
  allianceId: string;
  ashedMemberId: string;
  memberName: string;
  total: number | null | undefined;
  source: LevelEventSource;
  hqUserId?: string | null;
}): Promise<boolean> {
  if (input.total == null || !Number.isFinite(input.total)) {
    return false;
  }
  const rawTotal = Math.round(input.total);
  if (rawTotal < 1) {
    return false;
  }
  const total = clampMemberHqLevel(rawTotal);

  if (input.source === "ashed_sync") {
    const decision = await decideAndMaybeApplyInboundStat({
      adapter: levelStatSyncAdapter,
      commanderId: input.commanderId,
      allianceId: input.allianceId,
      ashedMemberId: input.ashedMemberId,
      memberName: input.memberName,
      // Compare with raw Ashed so over-cap values surface as growth/conflicts;
      // applyAshedOnHq clamps before writing HQ.
      ashedTotal: rawTotal,
      hqUserId: input.hqUserId,
    });
    if (decision === "apply" && rawTotal > MAX_MEMBER_HQ_LEVEL) {
      // HQ is now capped; leave the event unsynced so /stat-sync can push the
      // corrected level back to Ashed.
      const meta = await loadLatestNonDiscardedEventMeta(
        "level",
        input.commanderId,
      );
      if (meta.eventId) {
        const db = getDb();
        await db
          .update(schema.commanderLevelEvents)
          .set({ ashedSyncedAt: null })
          .where(eq(schema.commanderLevelEvents.id, meta.eventId));
      }
    }
    return decision === "apply";
  }

  return upsertCommanderLevel({
    commanderId: input.commanderId,
    total,
    allianceId: input.allianceId,
    ashedMemberId: input.ashedMemberId,
    memberName: input.memberName,
    source: input.source,
    hqUserId: input.hqUserId ?? null,
  });
}

export async function syncCommanderLevelForMemberIfLinked(input: {
  allianceId: string;
  ashedMemberId: string;
  memberName: string;
  memberLevel: number | null | undefined;
  source: LevelEventSource;
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

  await seedCommanderLevelHistoryFromAshed({
    commanderId,
    allianceId: input.allianceId,
    history: input.history,
    source: input.source,
  });

  await syncCommanderLevelFromAllianceMember({
    commanderId,
    allianceId: input.allianceId,
    ashedMemberId: input.ashedMemberId,
    memberName: input.memberName,
    total: input.memberLevel,
    source: input.source,
    hqUserId: input.hqUserId,
  });
}

export { clampMemberHqLevel };
