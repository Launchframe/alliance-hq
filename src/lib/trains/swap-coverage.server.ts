import "server-only";

import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb, schema } from "@/lib/db";
import { lockAllianceAvailability } from "@/lib/time-off/availability.server";
import { assertDutyCoverage, recordAppliedTrainCoverage, trainCoverageDuties } from "@/lib/time-off/coverage.server";
import { getServerCalendarDate } from "./game-time";

export async function swapConductorDrafts(input: { allianceId: string; dateA: string; dateB: string }) {
  if (input.dateA === input.dateB) throw new Error("Pick two different days to swap.");
  if (input.dateB <= getServerCalendarDate()) throw new Error("Swap targets must be a future day.");
  return getDb().transaction(async (tx) => {
    await lockAllianceAvailability(tx, input.allianceId);
    const snapshots = await tx.select({ row: schema.trainConductorRecords, version: sql<string>`${schema.trainConductorRecords}.xmin::text` }).from(schema.trainConductorRecords)
      .where(and(eq(schema.trainConductorRecords.allianceId, input.allianceId), inArray(schema.trainConductorRecords.date, [input.dateA, input.dateB])))
      .orderBy(schema.trainConductorRecords.date).for("update");
    const a = snapshots.find(({ row }) => row.date === input.dateA);
    const b = snapshots.find(({ row }) => row.date === input.dateB);
    if (!a?.row.conductorMemberId || !a.row.conductorMemberName) throw new Error(`No conductor set for ${input.dateA}.`);
    if (a.row.lockedAt || b?.row.lockedAt) throw new Error("Unlock conductor days before swapping.");
    const rankForDate = async (memberId: string | null, date: string) => {
      if (!memberId) return null;
      const [rank] = await tx.select({ id: schema.memberAllianceRankEvents.id }).from(schema.memberAllianceRankEvents)
        .where(and(eq(schema.memberAllianceRankEvents.allianceId, input.allianceId), eq(schema.memberAllianceRankEvents.ashedMemberId, memberId), lte(schema.memberAllianceRankEvents.effectiveDate, date)))
        .orderBy(desc(schema.memberAllianceRankEvents.effectiveDate)).limit(1);
      return rank?.id ?? null;
    };
    const source = a.row;
    const target = b?.row;
    const nextA = { ...source, conductorMemberId: target?.conductorMemberId ?? null, conductorMemberName: target?.conductorMemberName ?? null, conductorRankEventId: await rankForDate(target?.conductorMemberId ?? null, input.dateA), updatedAt: new Date() };
    const nextB = { ...(target ?? source), id: target?.id ?? nanoid(), date: input.dateB, conductorMemberId: source.conductorMemberId, conductorMemberName: source.conductorMemberName, conductorRankEventId: await rankForDate(source.conductorMemberId, input.dateB), updatedAt: new Date() };
    const duties = [...trainCoverageDuties(nextA, a.version).filter((duty) => duty.dutyRole === "conductor"), ...trainCoverageDuties(nextB, b?.version ?? "unassigned").filter((duty) => duty.dutyRole === "conductor").map((duty) => ({ ...duty, assignmentId: target?.id ?? `train:${input.dateB}` }))];
    await assertDutyCoverage(tx, input.allianceId, duties);
    await tx.update(schema.trainConductorRecords).set({ conductorMemberId: nextA.conductorMemberId, conductorMemberName: nextA.conductorMemberName, conductorRankEventId: nextA.conductorRankEventId, substituteForMemberId: source.conductorMemberId, substituteForMemberName: source.conductorMemberName, ...(nextA.conductorMemberId ? {} : { vipMemberId: null, vipMemberName: null, vipRankEventId: null }), updatedAt: nextA.updatedAt }).where(eq(schema.trainConductorRecords.id, source.id));
    const targetPatch = { conductorMemberId: nextB.conductorMemberId, conductorMemberName: nextB.conductorMemberName, conductorRankEventId: nextB.conductorRankEventId, substituteForMemberId: target?.conductorMemberId ?? null, substituteForMemberName: target?.conductorMemberName ?? null, updatedAt: nextB.updatedAt };
    if (target) await tx.update(schema.trainConductorRecords).set(targetPatch).where(eq(schema.trainConductorRecords.id, target.id));
    else await tx.insert(schema.trainConductorRecords).values({ id: nextB.id, allianceId: input.allianceId, date: input.dateB, seasonKey: source.seasonKey, ...targetPatch });
    for (const [memberId, fromDate, toDate] of [[source.conductorMemberId, input.dateA, input.dateB], [target?.conductorMemberId, input.dateB, input.dateA]]) {
      if (!memberId) continue;
      await tx.update(schema.conductorPoolEntries).set({ selectedForDate: toDate }).where(and(eq(schema.conductorPoolEntries.allianceId, input.allianceId), eq(schema.conductorPoolEntries.memberId, memberId), eq(schema.conductorPoolEntries.selectedForDate, fromDate!)));
    }
    if (!nextA.conductorMemberId && source.vipMemberId) await tx.update(schema.conductorPoolEntries).set({ selectedAt: null, selectedForDate: null }).where(and(eq(schema.conductorPoolEntries.allianceId, input.allianceId), eq(schema.conductorPoolEntries.memberId, source.vipMemberId), eq(schema.conductorPoolEntries.selectedForDate, input.dateA)));
    const records = await tx.select().from(schema.trainConductorRecords).where(and(eq(schema.trainConductorRecords.allianceId, input.allianceId), inArray(schema.trainConductorRecords.date, [input.dateA, input.dateB])));
    for (const record of records) await recordAppliedTrainCoverage(tx, input.allianceId, record.id);
    return { records: records.filter((row) => row.conductorMemberId && row.conductorMemberName) };
  });
}
