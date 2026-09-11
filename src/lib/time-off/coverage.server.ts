import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { and, eq, gte, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { configuredShiftOccurrences } from "@/lib/professions/coverage-time.shared";
import { isTimeOffDate } from "./workflow.shared";
import { lockAllianceAvailability, type AvailabilityTransaction } from "./availability.server";
import { acceptsCoverage, type CoverageAcceptance, type CoverageConflict } from "./coverage.shared";

export type CoverageActor = { allianceId: string; hqUserId?: string | null; discordUserId?: string; acceptance?: CoverageAcceptance; conflict?: CoverageConflictError; approved?: CoverageConflict[] };
const actors = new AsyncLocalStorage<CoverageActor>();
export function withCoverageActor<T>(actor: CoverageActor, work: () => Promise<T>): Promise<T> {
  return actors.run(actor, work);
}

export class CoverageConflictError extends Error {
  constructor(public readonly conflicts: CoverageConflict[]) {
    super("coverage_conflict");
  }
}

type Duty = Omit<CoverageConflict, "absenceVersion">;
type TrainRecord = typeof schema.trainConductorRecords.$inferSelect;
export function trainCoverageDuties(row: TrainRecord, assignmentVersion: string): Duty[] {
  return (["conductor", "vip"] as const).flatMap((dutyRole) => {
    const memberId = dutyRole === "conductor" ? row.conductorMemberId : row.vipMemberId;
    const memberName = dutyRole === "conductor" ? row.conductorMemberName : row.vipMemberName;
    return memberId ? [{ assignmentId: row.id, assignmentVersion, dutyDate: row.date, dutyRole, memberId, memberName: memberName ?? "", lockedAt: row.lockedAt?.toISOString() ?? null }] : [];
  });
}

export async function findCoverageConflicts(tx: AvailabilityTransaction, allianceId: string, duties: Duty[]): Promise<CoverageConflict[]> {
  if (!duties.length) return [];
  const dates = duties.map((duty) => duty.dutyDate).sort();
  const notices = await tx.select({ id: schema.memberTimeOff.id, version: schema.memberTimeOff.version, memberId: schema.memberTimeOff.ashedMemberId, startDate: schema.memberTimeOff.startDate, endDate: schema.memberTimeOff.endDate })
    .from(schema.memberTimeOff).where(and(eq(schema.memberTimeOff.allianceId, allianceId), inArray(schema.memberTimeOff.ashedMemberId, [...new Set(duties.map((duty) => duty.memberId))]),
      eq(schema.memberTimeOff.globalAbsence, true), isNull(schema.memberTimeOff.cancelledAt), lte(schema.memberTimeOff.startDate, dates[dates.length - 1]!), gte(schema.memberTimeOff.endDate, dates[0]!)));
  return duties.flatMap((duty) => {
    const overlapping = notices.filter((notice) => notice.memberId === duty.memberId && notice.startDate <= duty.dutyDate && notice.endDate >= duty.dutyDate);
    return overlapping.length ? [{ ...duty, absenceVersion: createHash("sha256").update(JSON.stringify(overlapping.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map((n) => [n.id, n.version]))).digest("hex") }] : [];
  });
}

export async function assertDutyCoverage(tx: AvailabilityTransaction, allianceId: string, duties: Duty[]): Promise<void> {
  const conflicts = await findCoverageConflicts(tx, allianceId, duties);
  if (!conflicts.length) return;
  const actor = actors.getStore();
  if (!actor || actor.allianceId !== allianceId || (!actor.hqUserId && !actor.discordUserId) || !acceptsCoverage(conflicts, actor.acceptance)) {
    const error = new CoverageConflictError(conflicts);
    if (actor) actor.conflict = error;
    throw error;
  }
  actor.approved = [...(actor.approved ?? []), ...conflicts];
  const acceptance = actor.acceptance!;
  const id = createHash("sha256").update(JSON.stringify(["duty-coverage", allianceId, actor.hqUserId ?? null, actor.discordUserId ?? null, acceptance.requestId, conflicts])).digest("hex");
  await tx.insert(schema.auditLog).values({ id, allianceId, hqUserId: actor.hqUserId ?? null, action: "time_off.coverage_keep", resourceType: conflicts[0]!.dutyRole === "engineer" ? "wl_eng_assignment" : "train_conductor_record", resourceId: conflicts[0]!.assignmentId,
    metadata: { conflicts, note: acceptance.note.trim(), requestId: acceptance.requestId, discordUserId: actor.discordUserId ?? null } }).onConflictDoNothing();
}

export async function recordAppliedTrainCoverage(tx: AvailabilityTransaction, allianceId: string, assignmentId: string) {
  const actor = actors.getStore();
  if (!actor?.approved?.length || actor.allianceId !== allianceId || !actor.acceptance) return;
  const [record] = await tx.select({ row: schema.trainConductorRecords, version: sql<string>`${schema.trainConductorRecords}.xmin::text` }).from(schema.trainConductorRecords).where(and(eq(schema.trainConductorRecords.id, assignmentId), eq(schema.trainConductorRecords.allianceId, allianceId)));
  if (!record) return;
  const conflicts = (await findCoverageConflicts(tx, allianceId, trainCoverageDuties(record.row, record.version))).filter((current) => actor.approved!.some((approved) => approved.dutyDate === current.dutyDate && approved.dutyRole === current.dutyRole && approved.memberId === current.memberId && approved.absenceVersion === current.absenceVersion));
  if (!conflicts.length) return;
  const id = createHash("sha256").update(JSON.stringify(["coverage-applied", allianceId, actor.hqUserId ?? null, actor.discordUserId ?? null, actor.acceptance.requestId, conflicts])).digest("hex");
  await tx.insert(schema.auditLog).values({ id, allianceId, hqUserId: actor.hqUserId ?? null, action: "time_off.coverage_applied", resourceType: "train_conductor_record", resourceId: assignmentId, metadata: { conflicts, reviewedConflicts: actor.approved, requestId: actor.acceptance.requestId, discordUserId: actor.discordUserId ?? null } }).onConflictDoNothing();
}

export async function recordAppliedProfessionCoverage(tx: AvailabilityTransaction, allianceId: string, assignmentId: string, assignmentVersion: string): Promise<void> {
  const actor = actors.getStore();
  const reviewed = actor?.approved?.filter((duty) => duty.dutyRole === "engineer" && duty.assignmentId === assignmentId);
  if (!reviewed?.length || actor?.allianceId !== allianceId || !actor.acceptance) return;
  const conflicts = reviewed.map((duty) => ({ ...duty, assignmentVersion }));
  const id = createHash("sha256").update(JSON.stringify(["profession-coverage-applied", allianceId, actor.hqUserId, actor.acceptance.requestId, conflicts])).digest("hex");
  await tx.insert(schema.auditLog).values({ id, allianceId, hqUserId: actor.hqUserId ?? null, action: "time_off.coverage_applied", resourceType: "wl_eng_assignment", resourceId: assignmentId, metadata: { conflicts, reviewedConflicts: reviewed, requestId: actor.acceptance.requestId } }).onConflictDoNothing();
}

export async function professionCoverageDuties(tx: AvailabilityTransaction, allianceId: string, startDate: string, endDate = startDate): Promise<Duty[]> {
  const rows = await tx.select({ id: schema.wlEngAssignments.id, assignedAt: schema.wlEngAssignments.assignedAt, coverageStartHour: schema.wlEngAssignments.coverageStartHour, coverageEndHour: schema.wlEngAssignments.coverageEndHour, version: sql<string>`${schema.wlEngAssignments}.xmin::text`, memberId: schema.commanderAllianceMemberships.ashedMemberId, memberName: schema.commanders.primaryName })
    .from(schema.wlEngAssignments)
    .innerJoin(schema.commanderAllianceMemberships, and(eq(schema.commanderAllianceMemberships.commanderId, schema.wlEngAssignments.engCommanderId), eq(schema.commanderAllianceMemberships.allianceId, allianceId), isNull(schema.commanderAllianceMemberships.leftAt)))
    .innerJoin(schema.commanders, eq(schema.commanders.id, schema.wlEngAssignments.engCommanderId))
    .where(and(eq(schema.wlEngAssignments.allianceId, allianceId), eq(schema.wlEngAssignments.status, "active"), isNotNull(schema.wlEngAssignments.coverageStartHour), isNotNull(schema.wlEngAssignments.coverageEndHour)));
  return rows.flatMap((row) => configuredShiftOccurrences(row, startDate, endDate).map((occurrence) => ({ ...occurrence, assignmentId: row.id, assignmentVersion: row.version, dutyRole: "engineer" as const, memberId: row.memberId, memberName: row.memberName ?? "", lockedAt: null })));
}

export async function listCoverageConflictsTx(tx: AvailabilityTransaction, allianceId: string, startDate: string, endDate: string) {
  const records = await tx.select({ row: schema.trainConductorRecords, version: sql<string>`${schema.trainConductorRecords}.xmin::text` }).from(schema.trainConductorRecords)
    .where(and(eq(schema.trainConductorRecords.allianceId, allianceId), gte(schema.trainConductorRecords.date, startDate), lte(schema.trainConductorRecords.date, endDate)));
  const conflicts = await findCoverageConflicts(tx, allianceId, [...records.flatMap(({ row, version }) => trainCoverageDuties(row, version)), ...await professionCoverageDuties(tx, allianceId, startDate, endDate)]);
  const audits = await tx.select({ metadata: schema.auditLog.metadata }).from(schema.auditLog).where(and(eq(schema.auditLog.allianceId, allianceId), inArray(schema.auditLog.action, ["time_off.coverage_keep", "time_off.coverage_applied"])));
  return conflicts.filter((conflict) => !audits.some(({ metadata }) => {
    const accepted = metadata as { conflicts?: CoverageConflict[] } | null;
    return acceptsCoverage([conflict], { conflicts: accepted?.conflicts ?? [], note: "accepted", requestId: "accepted_coverage_1" });
  }));
}

export async function listCoverageConflicts(allianceId: string, startDate: string, endDate: string) {
  return getDb().transaction(async (tx) => {
    await lockAllianceAvailability(tx, allianceId);
    return listCoverageConflictsTx(tx, allianceId, startDate, endDate);
  });
}

export async function keepCoverageAssignment(actor: CoverageActor, acceptance: CoverageAcceptance): Promise<void> {
  await withCoverageActor({ ...actor, acceptance }, () => getDb().transaction(async (tx) => {
    await lockAllianceAvailability(tx, actor.allianceId);
    if (!acceptance.conflicts?.length || acceptance.conflicts.length > 50) throw new CoverageConflictError([]);
    for (const accepted of acceptance.conflicts) {
      if (accepted.dutyRole === "engineer") {
        if (!isTimeOffDate(accepted.dutyDate)) throw new CoverageConflictError([]);
        await tx.select({ id: schema.wlEngAssignments.id }).from(schema.wlEngAssignments).where(and(eq(schema.wlEngAssignments.id, accepted.assignmentId), eq(schema.wlEngAssignments.allianceId, actor.allianceId))).for("update");
        const duties = (await professionCoverageDuties(tx, actor.allianceId, accepted.dutyDate)).filter((duty) => duty.assignmentId === accepted.assignmentId && duty.dutyStartAt === accepted.dutyStartAt && duty.dutyEndAt === accepted.dutyEndAt);
        const current = await findCoverageConflicts(tx, actor.allianceId, duties);
        if (!current.length || !acceptsCoverage(current, acceptance)) throw new CoverageConflictError(current);
        await assertDutyCoverage(tx, actor.allianceId, duties);
        continue;
      }
      const [record] = await tx.select({ row: schema.trainConductorRecords, version: sql<string>`${schema.trainConductorRecords}.xmin::text` }).from(schema.trainConductorRecords)
        .where(and(eq(schema.trainConductorRecords.allianceId, actor.allianceId), eq(schema.trainConductorRecords.id, accepted.assignmentId))).for("update");
      if (!record) throw new CoverageConflictError([]);
      const duties = trainCoverageDuties(record.row, record.version).filter((duty) => duty.dutyRole === accepted.dutyRole);
      const current = await findCoverageConflicts(tx, actor.allianceId, duties);
      if (!current.length || !acceptsCoverage(current, acceptance)) throw new CoverageConflictError(current);
      await assertDutyCoverage(tx, actor.allianceId, duties);
    }
  }));
}
