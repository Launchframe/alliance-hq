import "server-only";

import { and, desc, eq, isNotNull } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "@/lib/db";
import {
  busterDayWeekDates,
  busterDayWeekMondayForDate,
  isBusterDaySnapshotComplete,
  resolveBusterDayWizardPhase,
  type SerializedBusterDayReport,
} from "@/lib/vs-performance/buster-day.shared";
import {
  getServerCalendarDate,
  getWeekStartMonday,
} from "@/lib/trains/game-time";

type BusterDayReportRow = typeof schema.busterDayReports.$inferSelect;

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
  vsWeekMonday: string = getWeekStartMonday(getServerCalendarDate()),
): Promise<BusterDayReportRow> {
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
}): Promise<BusterDayReportRow> {
  const report = await getOrCreateBusterDayReport(
    input.allianceId,
    input.vsWeekMonday,
  );
  const dates = busterDayWeekDates(input.vsWeekMonday);
  const now = new Date();

  const nextRoster =
    input.rosterJobId !== undefined
      ? input.rosterJobId
      : input.kind === "pre"
        ? report.preRosterJobId
        : report.postRosterJobId;
  const nextKills =
    input.killsJobId !== undefined
      ? input.killsJobId
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
    .where(eq(schema.busterDayReports.id, report.id))
    .returning();

  if (!updated) {
    throw new Error("Failed to update buster day report.");
  }
  return updated;
}

export type BusterDayWizardState = {
  phase: ReturnType<typeof resolveBusterDayWizardPhase>;
  serverDate: string;
  week: ReturnType<typeof busterDayWeekDates>;
  report: SerializedBusterDayReport | null;
  latestCompleted: SerializedBusterDayReport | null;
};

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

  return {
    phase,
    serverDate,
    week,
    report: reportRow ? serializeBusterDayReport(reportRow) : null,
    latestCompleted: latestCompleted
      ? serializeBusterDayReport(latestCompleted)
      : null,
  };
}
