import "server-only";

import { and, asc, desc, eq, lt } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { listActiveTimeOffEntries } from "./repository.server";
import { isTimeOffDate, timeOffExcusesDate, TimeOffError } from "./workflow.shared";

export async function loadTimeOffAvailability(allianceId: string, date: string) {
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
  return {
    awayMemberIds: new Set(active.filter((entry) => entry.globalAbsence).map((entry) => entry.ashedMemberId)),
    excusedMemberIds: new Set(revisions.filter((revision) => timeOffExcusesDate([
      { snapshot: revision.snapshot, recordedAt: revision.recordedAt.toISOString() },
    ], date)).map((revision) => revision.ashedMemberId)),
  };
}
