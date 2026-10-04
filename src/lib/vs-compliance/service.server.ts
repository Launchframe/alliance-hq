import "server-only";

import { and, asc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { addCalendarDays } from "@/lib/trains/game-time";
import { validateVsPeriod } from "@/lib/vs-scores/evidence.shared";
import { VS_COMPLIANCE_MANAGE_PERMISSION, VS_COMPLIANCE_READ_PERMISSION } from "@/lib/rbac/constants";
import { requireVsComplianceAccess, type VsComplianceActor } from "./access.server";
import { loadComplianceStateVersion, lockCompliance, prepareExternalEvidence, resolveComplianceEvidence } from "./evidence.server";
import { authorizeComplianceTx, rebuildComplianceTx } from "./repository.server";
import { lastClosedVsWeek } from "./workflow.shared";
import { defaultVsPolicy, policyForVsWeek } from "./policy.shared";
import { retryComplianceSync } from "./sync.server";
import { VsComplianceError } from "./types.shared";

export async function evaluateComplianceAlliance(allianceId: string, weeks: string[], actor?: VsComplianceActor) {
  if (!weeks.length || weeks.some((week) => !validateVsPeriod(week, "weekly") || week > lastClosedVsWeek())) throw new VsComplianceError("invalid_week");
  const version = await loadComplianceStateVersion(allianceId);
  const external = await prepareExternalEvidence(allianceId, weeks);
  const preparedAt = Date.now();
  return getDb().transaction(async (tx) => {
    const state = await lockCompliance(tx, allianceId);
    if (actor) await authorizeComplianceTx(tx, actor, VS_COMPLIANCE_READ_PERMISSION);
    if (state.inputVersion !== version || Date.now() - preparedAt > 30_000) throw new VsComplianceError("changed", 409);
    const result = await rebuildComplianceTx(tx, allianceId, weeks, external);
    return { ...result, external, sourceReady: external.native || !!external.verifiedAt && weeks.every((week) => external.weeks.has(week)) };
  });
}

export async function loadComplianceDashboard(sessionId: string, allianceId: string, weekEnding = lastClosedVsWeek()) {
  const actor = await requireVsComplianceAccess(sessionId, allianceId, VS_COMPLIANCE_READ_PERMISSION);
  if (!validateVsPeriod(weekEnding, "weekly") || weekEnding > lastClosedVsWeek()) throw new VsComplianceError("invalid_week");
  let canManage = false;
  try { await requireVsComplianceAccess(sessionId, allianceId, VS_COMPLIANCE_MANAGE_PERMISSION); canManage = true; }
  catch (error) { if (!(error instanceof VsComplianceError) || error.code !== "forbidden") throw error; }
  const [first] = await getDb().select({ week: schema.vsCompliancePolicies.effectiveWeek }).from(schema.vsCompliancePolicies).where(and(eq(schema.vsCompliancePolicies.allianceId, allianceId), eq(schema.vsCompliancePolicies.enabled, true))).orderBy(asc(schema.vsCompliancePolicies.effectiveWeek)).limit(1);
  const initialWeeks = first && first.week <= weekEnding ? Array.from({ length: 4 }, (_, index) => addCalendarDays(first.week, index * 7)).filter((week) => week <= weekEnding) : [];
  const result = await evaluateComplianceAlliance(allianceId, [...new Set([...initialWeeks, weekEnding])], actor);
  return { weekEnding, canManage, rows: result.rows.filter((row) => row.weekEnding === weekEnding).map((row) => ({
    ...row.evaluation, id: row.id, memberId: row.memberId, memberName: row.memberName, currentRank: row.memberSnapshot.currentRank,
    settled: row.evaluation.settled ? { actionId: row.evaluation.settled.actionId, kind: row.evaluation.settled.kind, targetRank: row.evaluation.settled.targetRank } : null,
    dailyTarget: (policyForVsWeek(result.facts.policies, weekEnding) ?? defaultVsPolicy()).dailyTarget,
    daily: resolveComplianceEvidence(result.facts, row.memberId, weekEnding, result.external, row.remoteEvidence, row.remoteVerifiedAt).daily,
    evidenceState: row.input.evidence.state,
    syncStatus: result.jobs.find((job) => job.actionId === row.evaluation.settled?.actionId)?.status ?? (result.sourceReady ? "local" : "failed"),
  })) };
}

export async function runComplianceTick() {
  const closed = lastClosedVsWeek();
  await getDb().execute(sql`insert into vs_compliance_state(alliance_id, requested_from)
    select alliance_id, min(effective_week) from vs_compliance_policies where enabled and effective_week <= ${closed} group by alliance_id
    on conflict(alliance_id) do update set requested_from = least(vs_compliance_state.requested_from,
      case when vs_compliance_state.processed_through is null then excluded.requested_from
        when vs_compliance_state.processed_through < ${closed} then (vs_compliance_state.processed_through::date + 7)::text else null end)`);
  const states = await getDb().select().from(schema.vsComplianceState).where(and(sql`${schema.vsComplianceState.requestedFrom} <= ${closed}`, sql`${schema.vsComplianceState.nextAttemptAt} <= now()`)).orderBy(asc(schema.vsComplianceState.nextAttemptAt)).limit(2);
  let evaluated = 0;
  let failed = 0;
  for (const state of states) {
    if (!state.requestedFrom) continue;
    const weeks = Array.from({ length: 4 }, (_, index) => addCalendarDays(state.requestedFrom!, index * 7)).filter((week) => week <= closed);
    try {
      const result = await evaluateComplianceAlliance(state.allianceId, weeks);
      if (!result.sourceReady) throw new VsComplianceError("failed", 503);
      await getDb().transaction(async (tx) => {
        const current = await lockCompliance(tx, state.allianceId);
        if (current.inputVersion !== state.inputVersion || current.requestedFrom !== state.requestedFrom) return;
        const next = addCalendarDays(weeks.at(-1)!, 7);
        await tx.update(schema.vsComplianceState).set({ processedThrough: weeks.at(-1), requestedFrom: next <= closed ? next : null, nextAttemptAt: new Date(), lastError: null }).where(eq(schema.vsComplianceState.allianceId, state.allianceId));
      });
      evaluated += weeks.length;
    } catch {
      failed++;
      await getDb().update(schema.vsComplianceState).set({ lastError: "failed", nextAttemptAt: new Date(Date.now() + 60_000) }).where(eq(schema.vsComplianceState.allianceId, state.allianceId));
    }
  }
  const retried = await retryComplianceSync(2);
  return { evaluated, failed, retried };
}
