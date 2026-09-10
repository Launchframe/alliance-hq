import "server-only";

import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

import { writeAuditLog } from "@/lib/bff/audit";
import { getEffectiveSeasonForAlliance } from "@/lib/game-season/sync";
import { getDb, schema } from "@/lib/db";
import { addCalendarDays, getServerCalendarDate } from "@/lib/trains/game-time";
import { loadAllianceTrainLeadTimeSettings } from "@/lib/trains/alliance-train-lead-time.server";
import {
  resolveConductorNominationTrigger,
  type ConductorNominationTrigger,
} from "@/lib/trains/conductor-nomination-trigger.shared";
import {
  lockConductorRecord,
} from "@/lib/trains/repository";
import { getPoolSummary, releasePoolSelectionForDate } from "@/lib/trains/pool";
import { rollForConductor } from "@/lib/trains/service";
import { fetchAllianceVsTopScorersForTrainDate } from "@/lib/trains/vs-scores.server";
import {
  resolveMergedDayConfigsForDateRange,
  resolveTrainDayContext,
} from "@/lib/trains/train-day-context.server";
import {
  resolveNominationTopBoard,
  scoreDateForTrainDay,
  toDayMechanismConfig,
} from "@/lib/trains/train-day-context.shared";
import type { DayMechanismConfig } from "@/lib/trains/vs-score-scope.shared";
import { listActiveAllianceMembersForPool } from "@/lib/members/roster.server";

export const CONFIRMATION_PRIMARY_WINDOW_MS = 15 * 60 * 1000;
export const CONFIRMATION_SUCCESSOR_WINDOW_MS = 5 * 60 * 1000;
export const CONFIRMATION_MAX_SUCCESSORS = 3;
export const CONFIRMATION_HARD_STOP_MS = 30 * 60 * 1000;

export type SuccessionSnapshotEntry = {
  memberId: string;
  memberName: string;
  rank?: number | null;
};

export type NominationStatus =
  | "awaiting_scores"
  | "pending_confirmation"
  | "confirmed"
  | "forfeited"
  | "fallback_r4";

async function loadAllianceRow(allianceId: string) {
  const db = getDb();
  const [row] = await db
    .select({
      id: schema.alliances.id,
      trainWeekStartDow: schema.alliances.trainWeekStartDow,
      trainConductorLeadTimeDays: schema.alliances.trainConductorLeadTimeDays,
      trainConductorConfirmationEnabled:
        schema.alliances.trainConductorConfirmationEnabled,
    })
    .from(schema.alliances)
    .where(eq(schema.alliances.id, allianceId))
    .limit(1);
  return row ?? null;
}

async function loadRecord(allianceId: string, trainDate: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.trainConductorRecords)
    .where(
      and(
        eq(schema.trainConductorRecords.allianceId, allianceId),
        eq(schema.trainConductorRecords.date, trainDate),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function buildSuccessionSnapshot(input: {
  allianceId: string;
  trainDate: string;
  mechanism: string | null | undefined;
  conductorConfig: unknown;
  paintTemplate?: string | null;
  leadDays: number;
  scoreDateDay?: DayMechanismConfig | null;
  winner: { memberId: string; memberName: string };
}): Promise<SuccessionSnapshotEntry[]> {
  const topBoard = resolveNominationTopBoard({
    trainDate: input.trainDate,
    trainDay: {
      conductorMechanism: input.mechanism,
      conductorConfig: input.conductorConfig,
      paintTemplate: input.paintTemplate,
    },
    leadDays: input.leadDays,
    scoreDateDay: input.scoreDateDay,
  });
  if (topBoard?.kind === "vs") {
    const top = await fetchAllianceVsTopScorersForTrainDate(
      input.allianceId,
      input.trainDate,
      Math.max(topBoard.topN, 4),
      input.leadDays,
    );
    if (top.length > 0) {
      return top.map((c) => ({
        memberId: c.memberId,
        memberName: c.memberName,
        rank: c.allianceRank ?? null,
      }));
    }
  }

  const poolType =
    input.mechanism === "r4_sequence"
      ? "r4_plus"
      : input.mechanism === "heavy_hitter_lottery"
        ? "heavy_hitter"
        : input.mechanism === "r3_lottery"
          ? "r3"
          : null;

  if (poolType) {
    const db = getDb();
    const rows = await db
      .select({
        memberId: schema.conductorPoolEntries.memberId,
        memberName: schema.conductorPoolEntries.memberName,
        allianceRank: schema.conductorPoolEntries.allianceRank,
        sequencePosition: schema.conductorPoolEntries.sequencePosition,
        selectedAt: schema.conductorPoolEntries.selectedAt,
      })
      .from(schema.conductorPoolEntries)
      .where(
        and(
          eq(schema.conductorPoolEntries.allianceId, input.allianceId),
          eq(schema.conductorPoolEntries.poolType, poolType),
          isNull(schema.conductorPoolEntries.selectedAt),
        ),
      )
      .orderBy(
        sql`${schema.conductorPoolEntries.sequencePosition} ASC NULLS LAST`,
      )
      .limit(20);

    const snapshot: SuccessionSnapshotEntry[] = [
      {
        memberId: input.winner.memberId,
        memberName: input.winner.memberName,
      },
    ];
    for (const row of rows) {
      if (row.memberId === input.winner.memberId) continue;
      snapshot.push({
        memberId: row.memberId,
        memberName: row.memberName,
        rank: row.allianceRank ?? null,
      });
      if (snapshot.length >= 4) break;
    }
    return snapshot;
  }

  return [
    {
      memberId: input.winner.memberId,
      memberName: input.winner.memberName,
    },
  ];
}

/**
 * Nominate (or reuse draft) and open the R4 confirmation window.
 * Idempotent when already pending/confirmed/fallback.
 */
export async function nominateConductorForDate(input: {
  allianceId: string;
  trainDate: string;
  trigger: ConductorNominationTrigger;
  sessionId?: string;
  late?: boolean;
}): Promise<{ ok: boolean; reason?: string; recordId?: string }> {
  const alliance = await loadAllianceRow(input.allianceId);
  if (!alliance || alliance.trainConductorConfirmationEnabled !== 1) {
    return { ok: false, reason: "confirmation_disabled" };
  }

  const existing = await loadRecord(input.allianceId, input.trainDate);
  if (existing?.lockedAt) {
    return { ok: false, reason: "already_locked" };
  }
  const status = existing?.conductorNominationStatus;
  if (
    status === "pending_confirmation" ||
    status === "confirmed" ||
    status === "fallback_r4"
  ) {
    return { ok: true, recordId: existing!.id, reason: "already_nominated" };
  }

  const effectiveSeason = await getEffectiveSeasonForAlliance(input.allianceId);
  const dayContext = await resolveTrainDayContext({
    allianceId: input.allianceId,
    trainDate: input.trainDate,
    seasonKey: effectiveSeason.seasonKey,
    leadDays: alliance.trainConductorLeadTimeDays ?? 0,
  });
  const { dayConfig, leadDays, scoreDateDay } = dayContext;

  let winner: { memberId: string; memberName: string; mechanism?: string | null };
  if (existing?.conductorMemberId && existing.conductorMemberName) {
    winner = {
      memberId: existing.conductorMemberId,
      memberName: existing.conductorMemberName,
      mechanism: existing.conductorMechanism,
    };
  } else {
    const roll = await rollForConductor({
      allianceId: input.allianceId,
      date: input.trainDate,
    });
    if (!roll.memberId || !roll.memberName) {
      return { ok: false, reason: "roll_failed" };
    }
    winner = {
      memberId: roll.memberId,
      memberName: roll.memberName,
      mechanism: roll.mechanism,
    };
  }

  const snapshot = await buildSuccessionSnapshot({
    allianceId: input.allianceId,
    trainDate: input.trainDate,
    mechanism: winner.mechanism ?? dayConfig.conductorMechanism,
    conductorConfig: dayConfig.conductorConfig,
    paintTemplate: dayConfig.paintTemplate,
    leadDays,
    scoreDateDay,
    winner,
  });

  const now = new Date();
  const deadline = new Date(now.getTime() + CONFIRMATION_PRIMARY_WINDOW_MS);
  const triggerMode = input.trigger.mode;
  const rolledFresh =
    !(existing?.conductorMemberId && existing.conductorMemberName);
  const mechanism =
    winner.mechanism ?? dayConfig.conductorMechanism ?? null;

  const db = getDb();
  // Single CAS write for conductor + nomination window. Do not upsert-then-mark:
  // a loser overwrite between those steps can leave the winner's status on the
  // loser's member (and the loser's pool release would free the assigned seat).
  const nominationPatch = {
    conductorMemberId: winner.memberId,
    conductorMemberName: winner.memberName,
    conductorMechanism: mechanism,
    conductorNominationStatus: "pending_confirmation" as const,
    nominationTrigger: triggerMode,
    nominatedAt: now,
    confirmationDeadlineAt: deadline,
    successorAttempt: 0,
    successionSnapshot: snapshot,
    conductorConfirmedAt: null,
    conductorConfirmedByHqUserId: null,
    updatedAt: now,
  };

  let recordId: string | undefined;

  if (existing) {
    const claimed = await db
      .update(schema.trainConductorRecords)
      .set(nominationPatch)
      .where(
        and(
          eq(schema.trainConductorRecords.id, existing.id),
          isNull(schema.trainConductorRecords.lockedAt),
          or(
            isNull(schema.trainConductorRecords.conductorNominationStatus),
            eq(
              schema.trainConductorRecords.conductorNominationStatus,
              "awaiting_scores",
            ),
          ),
        ),
      )
      .returning({ id: schema.trainConductorRecords.id });

    if (claimed.length === 0) {
      if (rolledFresh) {
        await releasePoolSelectionForDate(
          input.allianceId,
          input.trainDate,
          winner.memberId,
        ).catch(() => undefined);
      }
      return {
        ok: true,
        recordId: existing.id,
        reason: "already_nominated",
      };
    }
    recordId = claimed[0]!.id;
  } else {
    const id = nanoid();
    try {
      await db.insert(schema.trainConductorRecords).values({
        id,
        allianceId: input.allianceId,
        date: input.trainDate,
        ...nominationPatch,
      });
      recordId = id;
    } catch {
      // Unique (alliance_id, date) — another nominator inserted first.
      if (rolledFresh) {
        await releasePoolSelectionForDate(
          input.allianceId,
          input.trainDate,
          winner.memberId,
        ).catch(() => undefined);
      }
      const raced = await loadRecord(input.allianceId, input.trainDate);
      return {
        ok: true,
        recordId: raced?.id,
        reason: "already_nominated",
      };
    }
  }

  if (input.late && input.sessionId) {
    await writeAuditLog({
      sessionId: input.sessionId,
      allianceId: input.allianceId,
      action: "trains.conductor_nomination_late",
      resourceType: "train_conductor_record",
      resourceId: recordId,
      metadata: {
        trainDate: input.trainDate,
        trigger: triggerMode,
        memberId: winner.memberId,
      },
    });
  }

  return { ok: true, recordId };
}

export async function confirmConductorPlacement(input: {
  allianceId: string;
  recordId: string;
  officerHqUserId: string;
  sessionId: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.trainConductorRecords)
    .where(
      and(
        eq(schema.trainConductorRecords.id, input.recordId),
        eq(schema.trainConductorRecords.allianceId, input.allianceId),
      ),
    )
    .limit(1);

  if (!row) return { ok: false, reason: "not_found" };
  if (row.lockedAt) return { ok: false, reason: "already_locked" };
  if (
    row.conductorNominationStatus !== "pending_confirmation" &&
    row.conductorNominationStatus !== "forfeited"
  ) {
    return { ok: false, reason: "not_pending" };
  }

  const now = new Date();
  // CAS: confirmation tick must not win a promote/fallback after this SELECT.
  const confirmed = await db
    .update(schema.trainConductorRecords)
    .set({
      conductorNominationStatus: "confirmed",
      conductorConfirmedAt: now,
      conductorConfirmedByHqUserId: input.officerHqUserId,
      confirmationDeadlineAt: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.trainConductorRecords.id, input.recordId),
        eq(schema.trainConductorRecords.allianceId, input.allianceId),
        isNull(schema.trainConductorRecords.lockedAt),
        or(
          eq(
            schema.trainConductorRecords.conductorNominationStatus,
            "pending_confirmation",
          ),
          eq(schema.trainConductorRecords.conductorNominationStatus, "forfeited"),
        ),
      ),
    )
    .returning({ id: schema.trainConductorRecords.id });

  if (confirmed.length === 0) {
    return { ok: false, reason: "not_pending" };
  }

  await writeAuditLog({
    sessionId: input.sessionId,
    allianceId: input.allianceId,
    hqUserId: input.officerHqUserId,
    action: "trains.conductor_confirmed",
    severity: "routine",
    resourceType: "train_conductor_record",
    resourceId: input.recordId,
    metadata: {
      permission: "trains:write",
      trainDate: row.date,
      memberId: row.conductorMemberId,
    },
  });

  return { ok: true };
}

async function promoteSuccessor(input: {
  allianceId: string;
  record: typeof schema.trainConductorRecords.$inferSelect;
  now: Date;
}): Promise<"promoted" | "exhausted" | "lost_race"> {
  const snapshot =
    (input.record.successionSnapshot as SuccessionSnapshotEntry[] | null) ??
    [];
  const nextAttempt = (input.record.successorAttempt ?? 0) + 1;
  if (nextAttempt > CONFIRMATION_MAX_SUCCESSORS) return "exhausted";

  const next = snapshot[nextAttempt];
  if (!next) return "exhausted";

  const previousMemberId = input.record.conductorMemberId;
  const deadline = new Date(
    input.now.getTime() + CONFIRMATION_SUCCESSOR_WINDOW_MS,
  );
  const db = getDb();
  // CAS before pool release: a concurrent officer confirm must win cleanly.
  const promoted = await db
    .update(schema.trainConductorRecords)
    .set({
      conductorMemberId: next.memberId,
      conductorMemberName: next.memberName,
      conductorNominationStatus: "pending_confirmation",
      successorAttempt: nextAttempt,
      confirmationDeadlineAt: deadline,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(schema.trainConductorRecords.id, input.record.id),
        eq(
          schema.trainConductorRecords.conductorNominationStatus,
          "pending_confirmation",
        ),
        eq(
          schema.trainConductorRecords.successorAttempt,
          input.record.successorAttempt ?? 0,
        ),
        isNull(schema.trainConductorRecords.lockedAt),
      ),
    )
    .returning({ id: schema.trainConductorRecords.id });

  if (promoted.length === 0) return "lost_race";

  if (previousMemberId && previousMemberId !== next.memberId) {
    await releasePoolSelectionForDate(
      input.allianceId,
      input.record.date,
      previousMemberId,
    ).catch(() => undefined);
  }

  return "promoted";
}

async function assignR4Fallback(input: {
  allianceId: string;
  record: typeof schema.trainConductorRecords.$inferSelect;
  now: Date;
}): Promise<void> {
  const summary = await getPoolSummary(input.allianceId, "r4_plus");
  let memberId: string | null = null;
  let memberName: string | null = null;

  if (summary.remaining > 0) {
    const db = getDb();
    const [row] = await db
      .select({
        memberId: schema.conductorPoolEntries.memberId,
        memberName: schema.conductorPoolEntries.memberName,
      })
      .from(schema.conductorPoolEntries)
      .where(
        and(
          eq(schema.conductorPoolEntries.allianceId, input.allianceId),
          eq(schema.conductorPoolEntries.poolType, "r4_plus"),
          isNull(schema.conductorPoolEntries.selectedAt),
        ),
      )
      .orderBy(
        sql`${schema.conductorPoolEntries.sequencePosition} ASC NULLS LAST`,
      )
      .limit(1);
    if (row) {
      memberId = row.memberId;
      memberName = row.memberName;
    }
  }

  if (!memberId) {
    const roster = await listActiveAllianceMembersForPool(input.allianceId);
    const r4 = roster
      .filter((m) => (m.allianceRank ?? 0) >= 4)
      .sort((a, b) => (a.allianceRank ?? 99) - (b.allianceRank ?? 99));
    if (r4[0]) {
      memberId = r4[0].ashedMemberId;
      memberName = r4[0].currentName;
    }
  }

  if (!memberId || !memberName) return;

  const previousMemberId = input.record.conductorMemberId;
  const db = getDb();
  // CAS: do not clobber a concurrent confirm/promote; assign R4 only while still pending.
  const fellBack = await db
    .update(schema.trainConductorRecords)
    .set({
      conductorMemberId: memberId,
      conductorMemberName: memberName,
      conductorMechanism: "r4_sequence",
      conductorNominationStatus: "fallback_r4",
      confirmationDeadlineAt: null,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(schema.trainConductorRecords.id, input.record.id),
        eq(
          schema.trainConductorRecords.conductorNominationStatus,
          "pending_confirmation",
        ),
        isNull(schema.trainConductorRecords.lockedAt),
      ),
    )
    .returning({ id: schema.trainConductorRecords.id });

  if (fellBack.length === 0) return;

  if (previousMemberId && previousMemberId !== memberId) {
    await releasePoolSelectionForDate(
      input.allianceId,
      input.record.date,
      previousMemberId,
    ).catch(() => undefined);
  }

  await writeAuditLog({
    sessionId: "system",
    allianceId: input.allianceId,
    action: "trains.conductor_r4_fallback",
    resourceType: "train_conductor_record",
    resourceId: input.record.id,
    metadata: {
      trainDate: input.record.date,
      memberId,
    },
  });
}

/** Cron: expire confirmation windows, promote successors, R4 fallback, auto-lock. */
export async function processConductorConfirmationTick(): Promise<{
  forfeits: number;
  fallbacks: number;
  autoLocks: number;
}> {
  const db = getDb();
  const now = new Date();
  const today = getServerCalendarDate();
  let forfeits = 0;
  let fallbacks = 0;
  let autoLocks = 0;

  const pending = await db
    .select()
    .from(schema.trainConductorRecords)
    .where(
      and(
        eq(
          schema.trainConductorRecords.conductorNominationStatus,
          "pending_confirmation",
        ),
        lte(schema.trainConductorRecords.confirmationDeadlineAt, now),
        isNull(schema.trainConductorRecords.lockedAt),
      ),
    );

  for (const record of pending) {
    const nominatedAt = record.nominatedAt?.getTime() ?? now.getTime();
    const hardStop = nominatedAt + CONFIRMATION_HARD_STOP_MS;
    if (now.getTime() >= hardStop) {
      await assignR4Fallback({
        allianceId: record.allianceId,
        record,
        now,
      });
      fallbacks += 1;
      continue;
    }

    const promoted = await promoteSuccessor({
      allianceId: record.allianceId,
      record,
      now,
    });
    if (promoted === "promoted") {
      forfeits += 1;
    } else if (promoted === "exhausted") {
      await assignR4Fallback({
        allianceId: record.allianceId,
        record,
        now,
      });
      fallbacks += 1;
    }
    // lost_race: concurrent confirm/promote already moved the row — skip.
  }

  const lockable = await db
    .select()
    .from(schema.trainConductorRecords)
    .where(
      and(
        eq(schema.trainConductorRecords.date, today),
        isNull(schema.trainConductorRecords.lockedAt),
        or(
          eq(schema.trainConductorRecords.conductorNominationStatus, "confirmed"),
          eq(
            schema.trainConductorRecords.conductorNominationStatus,
            "fallback_r4",
          ),
        ),
      ),
    );

  for (const record of lockable) {
    if (!record.conductorMemberId) continue;
    await lockConductorRecord(record.id, record.allianceId, null);
    autoLocks += 1;
  }

  return { forfeits, fallbacks, autoLocks };
}

/** After VS scores land for recordedDate, nominate score_upload train days. */
export async function maybeNominateConductorAfterVsUpload(input: {
  allianceId: string;
  vsRecordedDate: string;
}): Promise<{ nominated: number }> {
  const settings = await loadAllianceTrainLeadTimeSettings(
    input.allianceId,
    false,
  );
  if (!settings.trainConductorConfirmationEnabled) {
    return { nominated: 0 };
  }

  const leadDays = settings.trainConductorLeadTimeDays;
  const effectiveSeason = await getEffectiveSeasonForAlliance(input.allianceId);
  // Scan a small window of upcoming train dates (recordedDate+1 … +lead+7).
  const start = addCalendarDays(input.vsRecordedDate, 1);
  const end = addCalendarDays(input.vsRecordedDate, 1 + leadDays + 7);
  const mergedByDate = await resolveMergedDayConfigsForDateRange({
    allianceId: input.allianceId,
    startDate: start,
    endDate: end,
    seasonKey: effectiveSeason.seasonKey,
  });

  let nominated = 0;
  for (const day of mergedByDate.values()) {
    if (scoreDateForTrainDay(day.date, leadDays) !== input.vsRecordedDate) {
      continue;
    }
    const scoreDate = scoreDateForTrainDay(day.date, leadDays);
    const scoreDateRow = mergedByDate.get(scoreDate);
    const scoreDateDay = scoreDateRow
      ? toDayMechanismConfig(scoreDateRow)
      : null;
    const trigger = resolveConductorNominationTrigger({
      conductorMechanism: day.conductorMechanism,
      paintTemplate: day.paintTemplate,
      trainDate: day.date,
      leadDays,
      conductorConfig: day.conductorConfig,
      scoreDateDay,
    });
    if (trigger.mode !== "score_upload") continue;
    if (trigger.kind === "prior_day_vs" && trigger.scoreDate !== input.vsRecordedDate) {
      continue;
    }

    const today = getServerCalendarDate();
    const dayBefore = addCalendarDays(day.date, -1);
    const late = today > dayBefore;

    const result = await nominateConductorForDate({
      allianceId: input.allianceId,
      trainDate: day.date,
      trigger,
      late,
    });
    if (result.ok && result.reason !== "already_nominated") {
      nominated += 1;
    }
  }

  return { nominated };
}

/** Cron at server midnight: nominate tomorrow's scheduled_reset rules. */
export async function processScheduledConductorNominations(): Promise<{
  nominated: number;
}> {
  const db = getDb();
  const today = getServerCalendarDate();
  const tomorrow = addCalendarDays(today, 1);

  const alliances = await db
    .select({
      id: schema.alliances.id,
      trainConductorLeadTimeDays: schema.alliances.trainConductorLeadTimeDays,
      trainConductorConfirmationEnabled:
        schema.alliances.trainConductorConfirmationEnabled,
      trainWeekStartDow: schema.alliances.trainWeekStartDow,
    })
    .from(schema.alliances)
    .where(eq(schema.alliances.trainConductorConfirmationEnabled, 1));

  let nominated = 0;
  for (const alliance of alliances) {
    const effectiveSeason = await getEffectiveSeasonForAlliance(alliance.id);
    const dayContext = await resolveTrainDayContext({
      allianceId: alliance.id,
      trainDate: tomorrow,
      seasonKey: effectiveSeason.seasonKey,
      leadDays: alliance.trainConductorLeadTimeDays ?? 0,
    });
    const { dayConfig, scoreDateDay } = dayContext;
    const trigger = resolveConductorNominationTrigger({
      conductorMechanism: dayConfig.conductorMechanism,
      paintTemplate: dayConfig.paintTemplate,
      trainDate: tomorrow,
      leadDays: dayContext.leadDays,
      conductorConfig: dayConfig.conductorConfig,
      scoreDateDay,
    });
    if (trigger.mode !== "scheduled_reset") continue;

    const result = await nominateConductorForDate({
      allianceId: alliance.id,
      trainDate: tomorrow,
      trigger,
    });
    if (result.ok && result.reason !== "already_nominated") {
      nominated += 1;
    }
  }

  return { nominated };
}
