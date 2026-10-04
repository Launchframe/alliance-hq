import "server-only";

import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { addCalendarDays } from "@/lib/trains/game-time";
import { VS_COMPLIANCE_MANAGE_PERMISSION, VS_COMPLIANCE_READ_PERMISSION } from "@/lib/rbac/constants";
import { requireVsComplianceAccess } from "@/lib/vs-compliance/access.server";
import { loadComplianceStateVersion, prepareExternalEvidence, resolveComplianceEvidence } from "@/lib/vs-compliance/evidence.server";
import { policyForVsWeek } from "@/lib/vs-compliance/policy.shared";
import { computeComplianceRows } from "@/lib/vs-compliance/repository.server";
import { VsComplianceError } from "@/lib/vs-compliance/types.shared";
import { lastClosedVsWeek } from "@/lib/vs-compliance/workflow.shared";
import { buildVsMemberRow, parseVsMemberWeekQuery, queryVsMemberRows, summarizeVsMemberRows, vsMemberDisplayThreshold } from "./member-performance.shared";

export async function loadVsMemberWeek(sessionId: string, allianceId: string, rawQuery: Record<string, string | undefined>) {
  await requireVsComplianceAccess(sessionId, allianceId, VS_COMPLIANCE_READ_PERMISSION);
  const now = new Date();
  const query = parseVsMemberWeekQuery(rawQuery, now);
  const weekEnding = addCalendarDays(query.weekStart, 6);
  const lastClosed = lastClosedVsWeek(now);
  const live = weekEnding > lastClosed;
  const weekClosed = Date.parse(`${weekEnding}T02:00:00.000Z`) <= now.getTime();
  let canManage = false;
  try { await requireVsComplianceAccess(sessionId, allianceId, VS_COMPLIANCE_MANAGE_PERMISSION); canManage = true; }
  catch (error) { if (!(error instanceof VsComplianceError) || error.code !== "forbidden") throw error; }

  const external = await prepareExternalEvidence(allianceId, [weekEnding]);
  const [result, inputVersion, persisted] = await Promise.all([
    computeComplianceRows(getDb(), allianceId, [weekEnding], external, { now }),
    loadComplianceStateVersion(allianceId),
    getDb().select({ memberId: schema.vsComplianceEvaluations.memberId }).from(schema.vsComplianceEvaluations).where(and(eq(schema.vsComplianceEvaluations.allianceId, allianceId), eq(schema.vsComplianceEvaluations.weekEnding, weekEnding))),
  ]);
  const { facts } = result;
  const policy = policyForVsWeek(facts.policies, weekEnding);
  const evaluatedIds = new Set(persisted.map((row) => row.memberId));
  const weekDates = Array.from({ length: 6 }, (_, index) => addCalendarDays(weekEnding, index - 6));

  const members = facts.members.filter((roster) => {
    if (roster.member.active) return true;
    if (live) return false;
    if (evaluatedIds.has(roster.memberId)) return true;
    return facts.heads.some((head) => head.memberId === roster.memberId && (head.recordedDate === weekEnding || weekDates.includes(head.recordedDate)));
  });

  const allRows = members.map((roster) => {
    const row = result.rows.find((candidate) => candidate.memberId === roster.memberId && candidate.weekEnding === weekEnding);
    if (!row) throw new VsComplianceError("failed", 500);
    const resolved = resolveComplianceEvidence(facts, roster.memberId, weekEnding, external, row.remoteEvidence, row.remoteVerifiedAt);
    return buildVsMemberRow({
      memberId: roster.memberId,
      name: roster.name,
      member: roster.member,
      days: resolved.daily,
      evaluation: row.evaluation,
      policy,
      weekClosed,
      reportedTotal: resolved.evidence.source === "weekly" ? resolved.evidence.score : null,
      now: now.getTime(),
    });
  });

  const outstanding = result.rows.filter((row) => row.weekEnding !== weekEnding && (row.evaluation.recommendation.kind !== "none" || row.evaluation.correctionReview));
  const { rows, total } = queryVsMemberRows(allRows, query);
  const { summary, attention } = summarizeVsMemberRows(allRows);
  return {
    weekStart: query.weekStart,
    weekEnding,
    live,
    inputVersion,
    policy: {
      modelVersion: policy?.modelVersion ?? null,
      dailyThreshold: vsMemberDisplayThreshold(policy),
      allowedMissedDays: policy?.modelVersion === 2 ? policy.allowedMissedDays : null,
      enabled: policy?.enabled ?? false,
    },
    source: { native: external.native, verifiedAt: external.verifiedAt?.toISOString() ?? null, stale: !external.native && !external.verifiedAt },
    summary,
    attention,
    outstanding: { count: new Set(outstanding.map((row) => row.memberId)).size, weeks: [...new Set(outstanding.map((row) => row.weekEnding))].sort() },
    rows, total, page: query.page, pageSize: query.pageSize, canManage,
  };
}
