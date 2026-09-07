import "server-only";

import { and, asc, desc, eq, lt } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import type { MemberVsComplianceEvent } from "@/lib/db/schema";
import {
  countConsecutiveVsComplianceMisses,
  evaluateVsWeekOutcome,
  officerTaskStatusForOutcome,
} from "@/lib/vs-compliance/evaluate.shared";
import type {
  SerializedVsComplianceEvent,
  VsComplianceOutcome,
} from "@/lib/vs-compliance/types.shared";

export type ActiveRosterMemberForCompliance = {
  ashedMemberId: string;
  memberName: string;
};

/** Active roster members to evaluate for VS membership compliance (skips kicked/left members). */
export async function listActiveRosterMembersForCompliance(
  allianceId: string,
): Promise<ActiveRosterMemberForCompliance[]> {
  const rows = await getDb()
    .select({
      ashedMemberId: schema.allianceMembers.ashedMemberId,
      currentName: schema.allianceMembers.currentName,
    })
    .from(schema.allianceMembers)
    .where(
      and(
        eq(schema.allianceMembers.allianceId, allianceId),
        eq(schema.allianceMembers.status, "active"),
      ),
    );
  return rows.map((row) => ({
    ashedMemberId: row.ashedMemberId,
    memberName: row.currentName,
  }));
}

export function serializeVsComplianceEvent(
  row: MemberVsComplianceEvent,
): SerializedVsComplianceEvent {
  return {
    id: row.id,
    allianceId: row.allianceId,
    ashedMemberId: row.ashedMemberId,
    memberName: row.memberName,
    vsWeekEnding: row.vsWeekEnding,
    score: row.score,
    threshold: row.threshold,
    excused: row.excused,
    outcome: row.outcome as SerializedVsComplianceEvent["outcome"],
    strikeNumber: row.strikeNumber,
    officerTaskStatus:
      row.officerTaskStatus as SerializedVsComplianceEvent["officerTaskStatus"],
    waiveReason: row.waiveReason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function findComplianceEventForWeek(input: {
  allianceId: string;
  ashedMemberId: string;
  vsWeekEnding: string;
}): Promise<MemberVsComplianceEvent | null> {
  const [row] = await getDb()
    .select()
    .from(schema.memberVsComplianceEvents)
    .where(
      and(
        eq(schema.memberVsComplianceEvents.allianceId, input.allianceId),
        eq(schema.memberVsComplianceEvents.ashedMemberId, input.ashedMemberId),
        eq(schema.memberVsComplianceEvents.vsWeekEnding, input.vsWeekEnding),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function findComplianceEventById(input: {
  allianceId: string;
  eventId: string;
}): Promise<MemberVsComplianceEvent | null> {
  const [row] = await getDb()
    .select()
    .from(schema.memberVsComplianceEvents)
    .where(
      and(
        eq(schema.memberVsComplianceEvents.id, input.eventId),
        eq(schema.memberVsComplianceEvents.allianceId, input.allianceId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Count of consecutive non-waived "miss" weeks immediately preceding
 * `beforeVsWeekEnding` (misses "in a row", not a lifetime total — an old
 * isolated miss followed by an "ok" week does not carry forward). Looks back
 * at most 60 weeks, comfortably above the max configurable kick threshold (20).
 */
export async function countConsecutivePriorVsComplianceMisses(input: {
  allianceId: string;
  ashedMemberId: string;
  beforeVsWeekEnding: string;
}): Promise<number> {
  const rows = await getDb()
    .select({
      vsWeekEnding: schema.memberVsComplianceEvents.vsWeekEnding,
      outcome: schema.memberVsComplianceEvents.outcome,
    })
    .from(schema.memberVsComplianceEvents)
    .where(
      and(
        eq(schema.memberVsComplianceEvents.allianceId, input.allianceId),
        eq(schema.memberVsComplianceEvents.ashedMemberId, input.ashedMemberId),
        lt(schema.memberVsComplianceEvents.vsWeekEnding, input.beforeVsWeekEnding),
      ),
    )
    .orderBy(desc(schema.memberVsComplianceEvents.vsWeekEnding))
    .limit(60);

  return countConsecutiveVsComplianceMisses(
    rows.map((row) => ({
      vsWeekEnding: row.vsWeekEnding,
      outcome: row.outcome as VsComplianceOutcome,
    })),
    input.beforeVsWeekEnding,
  );
}

export type UpsertVsComplianceEventResult = {
  event: MemberVsComplianceEvent;
  /** True the first time this member/week flips into a miss (fresh officer task). */
  becameMiss: boolean;
  /** True when a previously open miss is no longer a miss (e.g. score corrected). */
  clearedFromMiss: boolean;
};

/**
 * Idempotent per (alliance, member, week): re-running updates score/threshold
 * without duplicating an open officer task. Once an officer has completed or
 * waived a week, later re-runs only refresh score bookkeeping and never
 * resurrect or re-open that task.
 */
export async function upsertVsComplianceEventForWeek(input: {
  allianceId: string;
  ashedMemberId: string;
  memberName: string;
  vsWeekEnding: string;
  score: number;
  minPoints: number;
  leewayPct: number;
  excused: boolean;
}): Promise<UpsertVsComplianceEventResult> {
  const db = getDb();
  const now = new Date();
  const existing = await findComplianceEventForWeek({
    allianceId: input.allianceId,
    ashedMemberId: input.ashedMemberId,
    vsWeekEnding: input.vsWeekEnding,
  });

  if (
    existing &&
    (existing.officerTaskStatus === "completed" ||
      existing.officerTaskStatus === "waived")
  ) {
    // Once an officer has resolved a week, freeze `outcome`/`excused` at
    // their resolved-time values — only refresh score/threshold bookkeeping
    // (e.g. a late score correction or an updated leeway setting). Updating
    // `excused` here without recomputing `outcome` would desync the two
    // (e.g. a row could end up `excused: true` while `outcome: "miss"`).
    const { threshold } = evaluateVsWeekOutcome({
      score: input.score,
      minPoints: input.minPoints,
      leewayPct: input.leewayPct,
      excused: existing.excused,
      priorMissCount: 0,
    });
    const [updated] = await db
      .update(schema.memberVsComplianceEvents)
      .set({
        memberName: input.memberName,
        score: input.score,
        threshold,
        updatedAt: now,
      })
      .where(eq(schema.memberVsComplianceEvents.id, existing.id))
      .returning();
    return { event: updated!, becameMiss: false, clearedFromMiss: false };
  }

  const priorMissCount = await countConsecutivePriorVsComplianceMisses({
    allianceId: input.allianceId,
    ashedMemberId: input.ashedMemberId,
    beforeVsWeekEnding: input.vsWeekEnding,
  });
  const result = evaluateVsWeekOutcome({
    score: input.score,
    minPoints: input.minPoints,
    leewayPct: input.leewayPct,
    excused: input.excused,
    priorMissCount,
  });
  const officerTaskStatus = officerTaskStatusForOutcome(result.outcome);

  if (!existing) {
    const [inserted] = await db
      .insert(schema.memberVsComplianceEvents)
      .values({
        id: nanoid(16),
        allianceId: input.allianceId,
        ashedMemberId: input.ashedMemberId,
        memberName: input.memberName,
        vsWeekEnding: input.vsWeekEnding,
        score: input.score,
        threshold: result.threshold,
        excused: input.excused,
        outcome: result.outcome,
        strikeNumber: result.strikeNumber,
        officerTaskStatus,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return {
      event: inserted!,
      becameMiss: result.outcome === "miss",
      clearedFromMiss: false,
    };
  }

  const wasMiss = existing.outcome === "miss";
  const [updated] = await db
    .update(schema.memberVsComplianceEvents)
    .set({
      memberName: input.memberName,
      score: input.score,
      threshold: result.threshold,
      excused: input.excused,
      outcome: result.outcome,
      strikeNumber: result.strikeNumber,
      officerTaskStatus,
      updatedAt: now,
    })
    .where(eq(schema.memberVsComplianceEvents.id, existing.id))
    .returning();

  return {
    event: updated!,
    becameMiss: result.outcome === "miss" && !wasMiss,
    clearedFromMiss: wasMiss && result.outcome !== "miss",
  };
}

export async function listOpenVsComplianceEvents(
  allianceId: string,
): Promise<SerializedVsComplianceEvent[]> {
  const rows = await getDb()
    .select()
    .from(schema.memberVsComplianceEvents)
    .where(
      and(
        eq(schema.memberVsComplianceEvents.allianceId, allianceId),
        eq(schema.memberVsComplianceEvents.officerTaskStatus, "open"),
      ),
    )
    .orderBy(
      desc(schema.memberVsComplianceEvents.vsWeekEnding),
      asc(schema.memberVsComplianceEvents.memberName),
    );
  return rows.map(serializeVsComplianceEvent);
}

export async function markVsComplianceEventComplete(input: {
  allianceId: string;
  eventId: string;
  hqUserId: string;
}): Promise<MemberVsComplianceEvent | null> {
  const [row] = await getDb()
    .update(schema.memberVsComplianceEvents)
    .set({
      officerTaskStatus: "completed",
      completedByHqUserId: input.hqUserId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.memberVsComplianceEvents.id, input.eventId),
        eq(schema.memberVsComplianceEvents.allianceId, input.allianceId),
        eq(schema.memberVsComplianceEvents.officerTaskStatus, "open"),
      ),
    )
    .returning();
  return row ?? null;
}

export async function waiveVsComplianceEvent(input: {
  allianceId: string;
  eventId: string;
  hqUserId: string;
  reason: string;
}): Promise<MemberVsComplianceEvent | null> {
  const [row] = await getDb()
    .update(schema.memberVsComplianceEvents)
    .set({
      outcome: "waived",
      officerTaskStatus: "waived",
      waiveReason: input.reason,
      waivedByHqUserId: input.hqUserId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.memberVsComplianceEvents.id, input.eventId),
        eq(schema.memberVsComplianceEvents.allianceId, input.allianceId),
        eq(schema.memberVsComplianceEvents.officerTaskStatus, "open"),
      ),
    )
    .returning();
  return row ?? null;
}
