import "server-only";

import { and, desc, eq, isNotNull } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import { MEMBER_ROSTER_VIDEO_SCORE_TARGET } from "@/lib/members/ashed-member-record";
import {
  busterDayWeekDates,
  busterDayWeekMondayForDate,
  isBusterDaySnapshotComplete,
  normalizeOptionalBusterDayJobId,
  resolveBusterDayWizardPhase,
  type SerializedBusterDayReport,
} from "@/lib/vs-performance/buster-day.shared";
import {
  loadBusterDayEfficiencyReport,
  type BusterDayEfficiencyReportPayload,
} from "@/lib/vs-performance/buster-day-efficiency.server";
import {
  getServerCalendarDate,
  getWeekStartMonday,
} from "@/lib/trains/game-time";
import { ALLIANCE_KILLS_VIDEO_SCORE_TARGET } from "@/lib/video/score-targets";

type BusterDayReportRow = typeof schema.busterDayReports.$inferSelect;

export type AttachBusterDaySnapshotJobResult =
  | { ok: true; report: BusterDayReportRow }
  | { ok: false; status: 400 | 404; error: string };

/**
 * Ensure a video job exists, belongs to the alliance, and matches the expected
 * score target. Cross-tenant misses return 404 (no existence leak).
 */
async function assertAllianceBusterDayVideoJob(input: {
  allianceId: string;
  jobId: string;
  expectedScoreTarget: string;
}): Promise<{ ok: true } | { ok: false; status: 400 | 404; error: string }> {
  const db = getDb();
  const [job] = await db
    .select({
      id: schema.videoJobs.id,
      allianceId: schema.videoJobs.allianceId,
      scoreTarget: schema.videoJobs.scoreTarget,
    })
    .from(schema.videoJobs)
    .where(eq(schema.videoJobs.id, input.jobId))
    .limit(1);

  if (!job || job.allianceId !== input.allianceId) {
    return { ok: false, status: 404, error: "Video job not found." };
  }
  if (job.scoreTarget !== input.expectedScoreTarget) {
    return {
      ok: false,
      status: 400,
      error: "Video job score target mismatch.",
    };
  }
  return { ok: true };
}

function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

export function serializeBusterDayReport(
  row: BusterDayReportRow,
): SerializedBusterDayReport {
  return {
    id: row.id,
    allianceId: row.allianceId,
    vsWeekMonday: row.vsWeekMonday,
    preSnapshotDate: row.preSnapshotDate,
    preRosterJobId: row.preRosterJobId,
    preKillsJobId: row.preKillsJobId,
    preCompletedAt: toIso(row.preCompletedAt),
    postSnapshotDate: row.postSnapshotDate,
    postRosterJobId: row.postRosterJobId,
    postKillsJobId: row.postKillsJobId,
    postCompletedAt: toIso(row.postCompletedAt),
    preReminderSentAt: toIso(row.preReminderSentAt),
    postReminderSentAt: toIso(row.postReminderSentAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    preComplete: isBusterDaySnapshotComplete({
      rosterJobId: row.preRosterJobId,
      killsJobId: row.preKillsJobId,
    }),
    postComplete: isBusterDaySnapshotComplete({
      rosterJobId: row.postRosterJobId,
      killsJobId: row.postKillsJobId,
    }),
  };
}

export async function getBusterDayReportByWeek(
  allianceId: string,
  vsWeekMonday: string,
): Promise<BusterDayReportRow | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.busterDayReports)
    .where(
      and(
        eq(schema.busterDayReports.allianceId, allianceId),
        eq(schema.busterDayReports.vsWeekMonday, vsWeekMonday),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Most recent report with both post jobs attached (efficiency-ready). */
export async function getLatestCompletedBusterDayReport(
  allianceId: string,
): Promise<BusterDayReportRow | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.busterDayReports)
    .where(
      and(
        eq(schema.busterDayReports.allianceId, allianceId),
        isNotNull(schema.busterDayReports.postCompletedAt),
      ),
    )
    .orderBy(desc(schema.busterDayReports.postCompletedAt))
    .limit(1);
  return row ?? null;
}

export async function getOrCreateBusterDayReport(
  allianceId: string,
  vsWeekMondayInput: string = getWeekStartMonday(getServerCalendarDate()),
): Promise<BusterDayReportRow> {
  const vsWeekMonday = busterDayWeekMondayForDate(vsWeekMondayInput);
  const existing = await getBusterDayReportByWeek(allianceId, vsWeekMonday);
  if (existing) return existing;

  const db = getDb();
  const now = new Date();
  const dates = busterDayWeekDates(vsWeekMonday);
  const row: BusterDayReportRow = {
    id: nanoid(),
    allianceId,
    vsWeekMonday,
    preSnapshotDate: dates.friday,
    preRosterJobId: null,
    preKillsJobId: null,
    preCompletedAt: null,
    postSnapshotDate: dates.sunday,
    postRosterJobId: null,
    postKillsJobId: null,
    postCompletedAt: null,
    preReminderSentAt: null,
    postReminderSentAt: null,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await db.insert(schema.busterDayReports).values(row);
    return row;
  } catch {
    // Unique race: another request created the week row.
    const raced = await getBusterDayReportByWeek(allianceId, vsWeekMonday);
    if (raced) return raced;
    throw new Error("Failed to create buster day report.");
  }
}

export type BusterDaySnapshotKind = "pre" | "post";

export async function attachBusterDaySnapshotJob(input: {
  allianceId: string;
  vsWeekMonday: string;
  kind: BusterDaySnapshotKind;
  rosterJobId?: string | null;
  killsJobId?: string | null;
}): Promise<AttachBusterDaySnapshotJobResult> {
  const vsWeekMonday = busterDayWeekMondayForDate(input.vsWeekMonday);

  const rosterNorm = normalizeOptionalBusterDayJobId(input.rosterJobId);
  if (!rosterNorm.ok) {
    return { ok: false, status: 400, error: rosterNorm.error };
  }
  const killsNorm = normalizeOptionalBusterDayJobId(input.killsJobId);
  if (!killsNorm.ok) {
    return { ok: false, status: 400, error: killsNorm.error };
  }

  if (rosterNorm.value) {
    const check = await assertAllianceBusterDayVideoJob({
      allianceId: input.allianceId,
      jobId: rosterNorm.value,
      expectedScoreTarget: MEMBER_ROSTER_VIDEO_SCORE_TARGET,
    });
    if (!check.ok) return check;
  }
  if (killsNorm.value) {
    const check = await assertAllianceBusterDayVideoJob({
      allianceId: input.allianceId,
      jobId: killsNorm.value,
      expectedScoreTarget: ALLIANCE_KILLS_VIDEO_SCORE_TARGET,
    });
    if (!check.ok) return check;
  }

  const report = await getOrCreateBusterDayReport(
    input.allianceId,
    vsWeekMonday,
  );
  const dates = busterDayWeekDates(vsWeekMonday);
  const now = new Date();

  const nextRoster =
    rosterNorm.value !== undefined
      ? rosterNorm.value
      : input.kind === "pre"
        ? report.preRosterJobId
        : report.postRosterJobId;
  const nextKills =
    killsNorm.value !== undefined
      ? killsNorm.value
      : input.kind === "pre"
        ? report.preKillsJobId
        : report.postKillsJobId;
  const complete = isBusterDaySnapshotComplete({
    rosterJobId: nextRoster,
    killsJobId: nextKills,
  });

  const patch =
    input.kind === "pre"
      ? {
          preSnapshotDate: dates.friday,
          preRosterJobId: nextRoster,
          preKillsJobId: nextKills,
          preCompletedAt: complete
            ? (report.preCompletedAt ?? now)
            : null,
          updatedAt: now,
        }
      : {
          postSnapshotDate: dates.sunday,
          postRosterJobId: nextRoster,
          postKillsJobId: nextKills,
          postCompletedAt: complete
            ? (report.postCompletedAt ?? now)
            : null,
          updatedAt: now,
        };

  const db = getDb();
  const [updated] = await db
    .update(schema.busterDayReports)
    .set(patch)
    .where(
      and(
        eq(schema.busterDayReports.id, report.id),
        eq(schema.busterDayReports.allianceId, input.allianceId),
      ),
    )
    .returning();

  if (!updated) {
    return {
      ok: false,
      status: 404,
      error: "Failed to update buster day report.",
    };
  }
  return { ok: true, report: updated };
}

export type BusterDayWizardState = {
  phase: ReturnType<typeof resolveBusterDayWizardPhase>;
  serverDate: string;
  week: ReturnType<typeof busterDayWeekDates>;
  report: SerializedBusterDayReport | null;
  latestCompleted: SerializedBusterDayReport | null;
  efficiency: BusterDayEfficiencyReportPayload | null;
};

async function efficiencyForCompletedReport(
  allianceId: string,
  report: BusterDayReportRow | SerializedBusterDayReport | null,
): Promise<BusterDayEfficiencyReportPayload | null> {
  if (!report) return null;
  const preComplete =
    "preComplete" in report
      ? report.preComplete
      : isBusterDaySnapshotComplete({
          rosterJobId: report.preRosterJobId,
          killsJobId: report.preKillsJobId,
        });
  const postComplete =
    "postComplete" in report
      ? report.postComplete
      : isBusterDaySnapshotComplete({
          rosterJobId: report.postRosterJobId,
          killsJobId: report.postKillsJobId,
        });
  if (!preComplete || !postComplete) return null;
  const preSnapshotDate = report.preSnapshotDate;
  const postSnapshotDate = report.postSnapshotDate;
  if (!preSnapshotDate || !postSnapshotDate) return null;

  return loadBusterDayEfficiencyReport({
    allianceId,
    vsWeekMonday: report.vsWeekMonday,
    preSnapshotDate,
    postSnapshotDate,
  });
}

/**
 * Load wizard state for the current Server Time day.
 * Creates this week's report row on Fri/Sun so upload deep-links have a home.
 */
export async function loadBusterDayWizardState(
  allianceId: string,
  now: Date = new Date(),
): Promise<BusterDayWizardState> {
  const serverDate = getServerCalendarDate(now);
  const phase = resolveBusterDayWizardPhase(serverDate);
  const vsWeekMonday = busterDayWeekMondayForDate(serverDate);
  const week = busterDayWeekDates(vsWeekMonday);

  let reportRow: BusterDayReportRow | null = null;
  if (phase === "pre_snapshot" || phase === "post_snapshot" || phase === "in_progress") {
    reportRow = await getOrCreateBusterDayReport(allianceId, vsWeekMonday);
  } else {
    reportRow = await getBusterDayReportByWeek(allianceId, vsWeekMonday);
  }

  const latestCompleted = await getLatestCompletedBusterDayReport(allianceId);
  const efficiencySource =
    reportRow &&
    isBusterDaySnapshotComplete({
      rosterJobId: reportRow.postRosterJobId,
      killsJobId: reportRow.postKillsJobId,
    })
      ? reportRow
      : latestCompleted;

  const efficiency = await efficiencyForCompletedReport(
    allianceId,
    efficiencySource,
  );

  return {
    phase,
    serverDate,
    week,
    report: reportRow ? serializeBusterDayReport(reportRow) : null,
    latestCompleted: latestCompleted
      ? serializeBusterDayReport(latestCompleted)
      : null,
    efficiency,
  };
}
