import "server-only";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb, schema } from "@/lib/db";
import { VS_COMPLIANCE_MANAGE_PERMISSION } from "@/lib/rbac/constants";
import { formatAshedMemberRankValue } from "@/lib/members/alliance-rank";
import { getServerCalendarDate } from "@/lib/trains/game-time";
import { planCurrentGenerationRankEligibilitySync, RANK_ELIGIBILITY_POOL_TYPES } from "@/lib/trains/pool-rank-eligibility.shared";
import { requireVsComplianceAccess } from "./access.server";
import { lockCompliance, prepareExternalEvidence, loadComplianceStateVersion, type ComplianceTx } from "./evidence.server";
import { authorizeComplianceTx, complianceHash, findComplianceReceipt, rebuildComplianceTx, type ComplianceRow } from "./repository.server";
import { validateComplianceCommand } from "./workflow.shared";
import { VsComplianceError } from "./types.shared";

async function recordNativeAction(tx: ComplianceTx, row: ComplianceRow, action: typeof schema.vsComplianceActions.$inferSelect, members: { memberId: string; name: string; member: { active: boolean; currentRank: number | null } }[]) {
  const now = action.recordedAt;
  const removal = action.kind === "remove";
  await tx.execute(sql`select set_config('app.vs_compliance_action', ${action.id}, true)`);
  if (!removal) await tx.insert(schema.memberAllianceRankEvents).values({ id: action.id, allianceId: row.allianceId, ashedMemberId: row.memberId, memberName: row.memberName, allianceRank: action.targetRank!, effectiveDate: getServerCalendarDate(now), source: "vs_compliance", recordedByHqUserId: action.actorId, recordedAt: now });
  const updated = await tx.update(schema.allianceMembers).set(removal ? { status: "former", updatedAt: now } : { allianceRank: action.targetRank, allianceRankTitle: null, ashedRankRaw: formatAshedMemberRankValue(action.targetRank!), updatedAt: now })
    .where(and(eq(schema.allianceMembers.allianceId, row.allianceId), eq(schema.allianceMembers.ashedMemberId, row.memberId), eq(schema.allianceMembers.status, "active"), eq(schema.allianceMembers.allianceRank, action.expectedRank!))).returning({ id: schema.allianceMembers.id });
  if (updated.length !== 1) throw new VsComplianceError("changed", 409);
  await tx.update(schema.commanderAllianceMemberships).set(removal ? { status: "former", leftAt: now, updatedAt: now } : { allianceRank: action.targetRank, allianceRankTitle: null, updatedAt: now })
    .where(and(eq(schema.commanderAllianceMemberships.allianceId, row.allianceId), eq(schema.commanderAllianceMemberships.ashedMemberId, row.memberId), eq(schema.commanderAllianceMemberships.status, "active")));
  if (removal) await tx.update(schema.memberAllianceTenure).set({ leftAt: now, updatedAt: now }).where(and(eq(schema.memberAllianceTenure.allianceId, row.allianceId), eq(schema.memberAllianceTenure.ashedMemberId, row.memberId), isNull(schema.memberAllianceTenure.leftAt)));
  const entries = await tx.select().from(schema.conductorPoolEntries).where(eq(schema.conductorPoolEntries.allianceId, row.allianceId)).for("update");
  const candidates = members.filter((member) => member.member.active && !(removal && member.memberId === row.memberId)).map((member) => ({ memberId: member.memberId, memberName: member.name, rank: member.memberId === row.memberId ? action.targetRank : member.member.currentRank }));
  for (const poolType of RANK_ELIGIBILITY_POOL_TYPES) {
    const generation = Math.max(0, ...entries.filter((entry) => entry.poolType === poolType).map((entry) => entry.generation));
    const current = entries.filter((entry) => entry.poolType === poolType && entry.generation === generation);
    const plan = planCurrentGenerationRankEligibilitySync({ poolType, entries: current, members: candidates });
    if (plan.unselectedEntryIdsToRemove.length) await tx.delete(schema.conductorPoolEntries).where(and(eq(schema.conductorPoolEntries.allianceId, row.allianceId), inArray(schema.conductorPoolEntries.id, plan.unselectedEntryIdsToRemove), isNull(schema.conductorPoolEntries.selectedAt)));
    for (const member of plan.membersToAdd) await tx.insert(schema.conductorPoolEntries).values({ id: nanoid(), allianceId: row.allianceId, poolType, generation, memberId: member.memberId, memberName: member.memberName, allianceRank: member.rank, sequencePosition: Math.max(0, ...current.map((entry) => entry.sequencePosition ?? 0)) + 1 }).onConflictDoNothing();
  }
  if (removal) {
    const currentGenerations = new Map<string, number>();
    for (const entry of entries) currentGenerations.set(entry.poolType, Math.max(currentGenerations.get(entry.poolType) ?? 0, entry.generation));
    const ids = entries.filter((entry) => entry.memberId === row.memberId && entry.selectedAt === null && currentGenerations.get(entry.poolType) === entry.generation).map((entry) => entry.id);
    if (ids.length) await tx.delete(schema.conductorPoolEntries).where(and(eq(schema.conductorPoolEntries.allianceId, row.allianceId), inArray(schema.conductorPoolEntries.id, ids), isNull(schema.conductorPoolEntries.selectedAt)));
  }
  await tx.insert(schema.vsComplianceRosterGuards).values({ allianceId: row.allianceId, memberId: row.memberId, actionId: action.id, rank: removal ? action.expectedRank : action.targetRank, status: removal ? "former" : "active", recordedAt: now })
    .onConflictDoUpdate({ target: [schema.vsComplianceRosterGuards.allianceId, schema.vsComplianceRosterGuards.memberId], set: { actionId: action.id, rank: removal ? action.expectedRank : action.targetRank, status: removal ? "former" : "active", recordedAt: now } });
  await tx.insert(schema.memberViolations).values({ id: nanoid(), allianceId: row.allianceId, ashedMemberId: row.memberId, memberName: row.memberName, violationType: "vs_compliance", recordedDate: row.weekEnding, complianceEventId: row.id, notes: null }).onConflictDoNothing();
}

export async function performComplianceAction(sessionId: string, allianceId: string, eventId: string, body: unknown, waiver: boolean) {
  const actor = await requireVsComplianceAccess(sessionId, allianceId, VS_COMPLIANCE_MANAGE_PERMISSION);
  const command = validateComplianceCommand(body, waiver);
  const digest = complianceHash([eventId, waiver, command]);
  const receipt = await findComplianceReceipt(allianceId, actor.hqUserId, command.requestId);
  if (receipt) {
    if (receipt.requestDigest !== digest) throw new VsComplianceError("changed", 409);
    return { ok: true as const, actionId: receipt.id };
  }
  const oldRows = await getDb().select().from(schema.vsComplianceEvaluations).where(eq(schema.vsComplianceEvaluations.allianceId, allianceId));
  const target = oldRows.find((row) => row.id === eventId);
  if (!target) throw new VsComplianceError("not_found", 404);
  const weeks = [...new Set(oldRows.map((row) => row.weekEnding))].sort();
  const version = await loadComplianceStateVersion(allianceId);
  const external = await prepareExternalEvidence(allianceId, weeks);
  const preparedAt = Date.now();
  return getDb().transaction(async (tx) => {
    const state = await lockCompliance(tx, allianceId);
    await authorizeComplianceTx(tx, actor, VS_COMPLIANCE_MANAGE_PERMISSION);
    const [retry] = await tx.select().from(schema.vsComplianceActions).where(and(eq(schema.vsComplianceActions.allianceId, allianceId), eq(schema.vsComplianceActions.actorId, actor.hqUserId), eq(schema.vsComplianceActions.requestId, command.requestId))).limit(1);
    if (retry) {
      if (retry.requestDigest !== digest) throw new VsComplianceError("changed", 409);
      return { ok: true as const, actionId: retry.id };
    }
    if (state.inputVersion !== version || Date.now() - preparedAt > 30_000) throw new VsComplianceError("changed", 409);
    const rebuilt = await rebuildComplianceTx(tx, allianceId, weeks, external);
    const row = rebuilt.rows.find((candidate) => candidate.id === eventId);
    if (!row || row.evaluation.confirmationBasis !== command.confirmationBasis) throw new VsComplianceError("changed", 409);
    if (rebuilt.actions.some((action) => action.eventId === eventId && (waiver ? action.kind === "waive" : action.kind !== "waive"))) throw new VsComplianceError("handled", 409);
    if (!waiver && (!row.memberSnapshot.active || row.memberSnapshot.isOwner || row.memberSnapshot.currentRank === null || row.memberSnapshot.currentRank >= 5 || !["demote", "remove"].includes(row.evaluation.recommendation.kind))) throw new VsComplianceError("changed", 409);
    if (waiver && !["missed", "pending_data"].includes(row.evaluation.outcome) && !row.evaluation.settled) throw new VsComplianceError("handled", 409);
    const action: typeof schema.vsComplianceActions.$inferSelect = { id: nanoid(), allianceId, eventId, memberId: row.memberId, actorId: actor.hqUserId, requestId: command.requestId, requestDigest: digest, kind: waiver ? "waive" : row.evaluation.recommendation.kind as "demote" | "remove", expectedRank: row.memberSnapshot.currentRank, targetRank: waiver ? null : row.evaluation.recommendation.targetRank, evaluationBasis: row.evaluation.evaluationBasis, memberSnapshot: row.memberSnapshot, reason: command.reason, recordedAt: new Date() };
    await tx.insert(schema.vsComplianceActions).values(action);
    if (!waiver) {
      await recordNativeAction(tx, row, action, rebuilt.facts.members);
      await tx.insert(schema.vsComplianceSyncJobs).values({ actionId: action.id, allianceId, memberId: row.memberId, status: rebuilt.facts.alliance.operatingMode === "native" ? "local" : "pending" });
    }
    await tx.update(schema.vsComplianceState).set({ inputVersion: sql`${schema.vsComplianceState.inputVersion} + 1`, requestedFrom: sql`least(${schema.vsComplianceState.requestedFrom}, ${row.weekEnding})`, nextAttemptAt: new Date() }).where(eq(schema.vsComplianceState.allianceId, allianceId));
    await rebuildComplianceTx(tx, allianceId, weeks, external);
    return { ok: true as const, actionId: action.id };
  });
}
