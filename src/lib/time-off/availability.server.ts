import "server-only";

import { and, asc, desc, eq, isNull, lt } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { listActiveTimeOffEntries } from "./repository.server";
import { isTimeOffDate, timeOffExcusesDate, TimeOffError } from "./workflow.shared";

export async function loadTimeOffAvailability(allianceId: string, date: string, activity: "vs" | "donation" | "all" = "all") {
  if (!isTimeOffDate(date)) throw new TimeOffError("invalidDate");
  const [active, revisions] = await Promise.all([
    listActiveTimeOffEntries({ allianceId, rangeStart: date, rangeEnd: date }),
    getDb().selectDistinctOn([schema.memberTimeOffRevisions.entryId], {
      snapshot: schema.memberTimeOffRevisions.snapshot,
      recordedAt: schema.memberTimeOffRevisions.recordedAt,
      ashedMemberId: schema.memberTimeOff.ashedMemberId,
    }).from(schema.memberTimeOffRevisions)
      .innerJoin(schema.memberTimeOff, and(
        eq(schema.memberTimeOff.id, schema.memberTimeOffRevisions.entryId),
        eq(schema.memberTimeOff.allianceId, schema.memberTimeOffRevisions.allianceId),
      ))
      .where(and(
        eq(schema.memberTimeOffRevisions.allianceId, allianceId),
        lt(schema.memberTimeOffRevisions.recordedAt, new Date(`${date}T02:00:00.000Z`)),
      ))
      .orderBy(asc(schema.memberTimeOffRevisions.entryId), desc(schema.memberTimeOffRevisions.version)),
  ]);
  const excusedMemberIds = new Set(revisions.filter((revision) => timeOffExcusesDate([
    { snapshot: revision.snapshot, recordedAt: revision.recordedAt.toISOString() },
  ], date, activity)).map((revision) => revision.ashedMemberId));
  if (activity !== "all") {
    const bindings = await getDb().select({ record: schema.timeOffSyncBindings.remoteSnapshot, memberId: schema.memberTimeOff.ashedMemberId })
      .from(schema.timeOffSyncBindings)
      .innerJoin(schema.memberTimeOff, and(eq(schema.memberTimeOff.id, schema.timeOffSyncBindings.entryId), eq(schema.memberTimeOff.allianceId, schema.timeOffSyncBindings.allianceId)))
      .where(and(eq(schema.timeOffSyncBindings.allianceId, allianceId), eq(schema.timeOffSyncBindings.origin, "ashed"), eq(schema.timeOffSyncBindings.status, "synced"), eq(schema.timeOffSyncBindings.recordType, activity), isNull(schema.memberTimeOff.cancelledAt)));
    for (const binding of bindings) {
      const record = binding.record;
      if (record?.memberId === binding.memberId && record.changedAt && Date.parse(record.changedAt) < Date.parse(`${date}T02:00:00.000Z`) && record.startDate <= date && date <= record.endDate) excusedMemberIds.add(binding.memberId);
    }
  }
  return {
    awayMemberIds: new Set(active.filter((entry) => entry.globalAbsence).map((entry) => entry.ashedMemberId)),
    excusedMemberIds,
    pendingMemberIds: new Set(active.filter((entry) => !entry.noticeVerified || ["conflict", "uncertain", "failed", "credentials_required"].includes(entry.syncStatus)).map((entry) => entry.ashedMemberId)),
  };
}
