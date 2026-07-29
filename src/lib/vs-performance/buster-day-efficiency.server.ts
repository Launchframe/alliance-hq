import "server-only";

import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import { parsePowerLevelM } from "@/lib/commanders/power-stats.shared";
import { getDb, schema } from "@/lib/db";
import { formatServerCalendarDate } from "@/lib/trains/game-time";
import { fetchAlliancePriorDayVsScoresByMember } from "@/lib/trains/vs-scores.server";
import { resolveHqAllianceIdFromStoredAllianceId } from "@/lib/video/video-job-alliance.server";
import {
  BUSTER_DAY_SNAPSHOT_MAX_DAY_DISTANCE,
  computeBusterDayEfficiencyReport,
  pickClosestByCalendarDate,
  powerByAshedMemberFromParsedRows,
  type SerializedBusterDayEfficiencyRow,
} from "@/lib/vs-performance/buster-day-efficiency.shared";
import { busterDayWeekDates } from "@/lib/vs-performance/buster-day.shared";

export type BusterDayEfficiencyReportPayload = {
  vsWeekMonday: string;
  saturday: string;
  preSnapshotDate: string;
  postSnapshotDate: string;
  vsScoresAvailable: boolean;
  rows: SerializedBusterDayEfficiencyRow[];
};

type MembershipRow = {
  commanderId: string;
  ashedMemberId: string;
  memberName: string;
};

async function listActiveAllianceMemberships(
  allianceId: string,
): Promise<MembershipRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      commanderId: schema.commanderAllianceMemberships.commanderId,
      ashedMemberId: schema.commanderAllianceMemberships.ashedMemberId,
      rosterNameAtMembership:
        schema.commanderAllianceMemberships.rosterNameAtMembership,
      primaryName: schema.commanders.primaryName,
      currentName: schema.allianceMembers.currentName,
    })
    .from(schema.commanderAllianceMemberships)
    .innerJoin(
      schema.commanders,
      eq(schema.commanders.id, schema.commanderAllianceMemberships.commanderId),
    )
    .leftJoin(
      schema.allianceMembers,
      and(
        eq(schema.allianceMembers.allianceId, allianceId),
        eq(
          schema.allianceMembers.ashedMemberId,
          schema.commanderAllianceMemberships.ashedMemberId,
        ),
      ),
    )
    .where(
      and(
        eq(schema.commanderAllianceMemberships.allianceId, allianceId),
        isNull(schema.commanderAllianceMemberships.leftAt),
      ),
    );

  return rows.map((row) => ({
    commanderId: row.commanderId,
    ashedMemberId: row.ashedMemberId,
    memberName: (
      row.currentName ||
      row.rosterNameAtMembership ||
      row.primaryName ||
      row.ashedMemberId
    ).trim(),
  }));
}

async function loadPowerEventsByCommander(
  allianceId: string,
  commanderIds: string[],
): Promise<Map<string, Array<{ recordedDate: string; value: string }>>> {
  const byCommander = new Map<
    string,
    Array<{ recordedDate: string; value: string }>
  >();
  if (commanderIds.length === 0) return byCommander;

  const db = getDb();
  const rows = await db
    .select({
      commanderId: schema.commanderPowerLevelEvents.commanderId,
      recordedDate: schema.commanderPowerLevelEvents.recordedDate,
      value: schema.commanderPowerLevelEvents.value,
    })
    .from(schema.commanderPowerLevelEvents)
    .where(
      and(
        eq(schema.commanderPowerLevelEvents.allianceId, allianceId),
        inArray(schema.commanderPowerLevelEvents.commanderId, commanderIds),
      ),
    )
    .orderBy(asc(schema.commanderPowerLevelEvents.recordedDate));

  for (const row of rows) {
    const list = byCommander.get(row.commanderId) ?? [];
    list.push({ recordedDate: row.recordedDate, value: row.value });
    byCommander.set(row.commanderId, list);
  }
  return byCommander;
}

async function loadKillsEventsByCommander(
  commanderIds: string[],
): Promise<Map<string, Array<{ total: number; recordedDate: string }>>> {
  const byCommander = new Map<
    string,
    Array<{ total: number; recordedDate: string }>
  >();
  if (commanderIds.length === 0) return byCommander;

  const db = getDb();
  const rows = await db
    .select({
      commanderId: schema.commanderKillsEvents.commanderId,
      total: schema.commanderKillsEvents.total,
      createdAt: schema.commanderKillsEvents.createdAt,
    })
    .from(schema.commanderKillsEvents)
    .where(
      and(
        inArray(schema.commanderKillsEvents.commanderId, commanderIds),
        isNull(schema.commanderKillsEvents.discardedAt),
      ),
    )
    .orderBy(asc(schema.commanderKillsEvents.createdAt));

  for (const row of rows) {
    const list = byCommander.get(row.commanderId) ?? [];
    list.push({
      total: row.total,
      recordedDate: formatServerCalendarDate(row.createdAt),
    });
    byCommander.set(row.commanderId, list);
  }
  return byCommander;
}

/**
 * Powers from an attached Members+Power video job, keyed by ashed member id.
 * Prefer these over historical power events so Sunday catch-up submits still
 * retain distinct Friday vs Sunday OCR readings.
 */
export async function loadPowerByAshedMemberFromRosterJob(
  allianceId: string,
  jobId: string | null | undefined,
): Promise<Map<string, number>> {
  const byMember = new Map<string, number>();
  const trimmed = jobId?.trim();
  if (!trimmed) return byMember;

  const db = getDb();
  const [job] = await db
    .select({
      parseSessionId: schema.videoJobs.parseSessionId,
      allianceId: schema.videoJobs.allianceId,
    })
    .from(schema.videoJobs)
    .where(eq(schema.videoJobs.id, trimmed))
    .limit(1);

  if (!job?.parseSessionId) {
    return byMember;
  }
  const jobAllianceId = await resolveHqAllianceIdFromStoredAllianceId(
    job.allianceId,
  );
  if (jobAllianceId !== allianceId) {
    return byMember;
  }

  const rows = await db
    .select({
      memberId: schema.parsedRows.memberId,
      powerLevel: schema.parsedRows.powerLevel,
      deleted: schema.parsedRows.deleted,
    })
    .from(schema.parsedRows)
    .where(eq(schema.parsedRows.parseSessionId, job.parseSessionId));

  return powerByAshedMemberFromParsedRows(rows);
}

function powerNearDate(
  events: Array<{ recordedDate: string; value: string }> | undefined,
  targetDate: string,
): number | null {
  if (!events?.length) return null;
  const closest = pickClosestByCalendarDate(
    events,
    targetDate,
    (row) => row.recordedDate,
    BUSTER_DAY_SNAPSHOT_MAX_DAY_DISTANCE,
  );
  return closest ? parsePowerLevelM(closest.value) : null;
}

function killsNearDate(
  events: Array<{ total: number; recordedDate: string }> | undefined,
  targetDate: string,
): number | null {
  if (!events?.length) return null;
  const closest = pickClosestByCalendarDate(
    events,
    targetDate,
    (row) => row.recordedDate,
    BUSTER_DAY_SNAPSHOT_MAX_DAY_DISTANCE,
  );
  return closest?.total ?? null;
}

/**
 * Rank commanders for a completed Buster Day report week.
 * Requires pre + post snapshot dates (Friday / Sunday).
 */
export async function loadBusterDayEfficiencyReport(input: {
  allianceId: string;
  vsWeekMonday: string;
  preSnapshotDate: string;
  postSnapshotDate: string;
  preRosterJobId?: string | null;
  postRosterJobId?: string | null;
}): Promise<BusterDayEfficiencyReportPayload> {
  const week = busterDayWeekDates(input.vsWeekMonday);
  const saturday = week.saturday;
  const memberships = await listActiveAllianceMemberships(input.allianceId);
  const commanderIds = memberships.map((row) => row.commanderId);

  const [
    powerByCommander,
    killsByCommander,
    vsByMember,
    preJobPowerByMember,
    postJobPowerByMember,
  ] = await Promise.all([
    loadPowerEventsByCommander(input.allianceId, commanderIds),
    loadKillsEventsByCommander(commanderIds),
    fetchAlliancePriorDayVsScoresByMember(input.allianceId, saturday),
    loadPowerByAshedMemberFromRosterJob(
      input.allianceId,
      input.preRosterJobId,
    ),
    loadPowerByAshedMemberFromRosterJob(
      input.allianceId,
      input.postRosterJobId,
    ),
  ]);

  const vsScoresAvailable = vsByMember.size > 0;

  const rows = computeBusterDayEfficiencyReport(
    memberships.map((member) => ({
      commanderId: member.commanderId,
      memberName: member.memberName,
      ashedMemberId: member.ashedMemberId,
      powerStartM:
        preJobPowerByMember.get(member.ashedMemberId) ??
        powerNearDate(
          powerByCommander.get(member.commanderId),
          input.preSnapshotDate,
        ),
      powerEndM:
        postJobPowerByMember.get(member.ashedMemberId) ??
        powerNearDate(
          powerByCommander.get(member.commanderId),
          input.postSnapshotDate,
        ),
      killsStart: killsNearDate(
        killsByCommander.get(member.commanderId),
        input.preSnapshotDate,
      ),
      killsEnd: killsNearDate(
        killsByCommander.get(member.commanderId),
        input.postSnapshotDate,
      ),
      vsScoreSaturday: vsByMember.get(member.ashedMemberId) ?? null,
    })),
  );

  return {
    vsWeekMonday: input.vsWeekMonday,
    saturday,
    preSnapshotDate: input.preSnapshotDate,
    postSnapshotDate: input.postSnapshotDate,
    vsScoresAvailable,
    rows,
  };
}
