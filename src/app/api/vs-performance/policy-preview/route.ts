import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { VS_COMPLIANCE_SETTINGS_PERMISSION } from "@/lib/rbac/constants";
import { requireApiSession } from "@/lib/session";
import { vsActorForSession } from "@/lib/vs-performance/api-helpers.server";
import { addCalendarDays } from "@/lib/trains/game-time";
import { validateVsPeriod } from "@/lib/vs-scores/evidence.shared";
import { requireVsComplianceAccess } from "@/lib/vs-compliance/access.server";
import { prepareExternalEvidence } from "@/lib/vs-compliance/evidence.server";
import { mergeVsPolicyPatch } from "@/lib/vs-compliance/policy.shared";
import { computeComplianceRows } from "@/lib/vs-compliance/repository.server";
import { complianceErrorResponse } from "@/lib/vs-compliance/routes.server";
import { VsComplianceError, type VsDailyPolicyVersion, type VsSequenceRule } from "@/lib/vs-compliance/types.shared";
import { complianceWeeks, lastClosedVsWeek } from "@/lib/vs-compliance/workflow.shared";

export const dynamic = "force-dynamic";

const sequenceWeeks = (rule: VsSequenceRule) => rule.unit === "weeks" ? rule.length : Math.ceil(rule.length / 6) + 1;

export async function POST(request: Request) {
  try {
    const session = await requireApiSession();
    if (session instanceof NextResponse) return session;
    const actor = vsActorForSession(session);
    if (actor instanceof NextResponse) throw new VsComplianceError("forbidden", 403);
    const allianceId = actor.allianceId;
    await requireVsComplianceAccess(session.id, allianceId, VS_COMPLIANCE_SETTINGS_PERMISSION);
    let body: unknown;
    try { body = await request.json(); } catch { throw new VsComplianceError("invalid_policy"); }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new VsComplianceError("invalid_policy");
    const { policy: patch, weekEnding } = body as { policy?: unknown; weekEnding?: unknown };
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new VsComplianceError("invalid_policy");
    if (typeof weekEnding !== "string" || !validateVsPeriod(weekEnding, "weekly") || weekEnding > lastClosedVsWeek()) throw new VsComplianceError("invalid_week");
    const merged = mergeVsPolicyPatch(null, { ...(patch as Record<string, unknown>), modelVersion: 2 }, new Date());
    if (merged.modelVersion !== 2) throw new VsComplianceError("invalid_policy");
    const span = Math.min(52, Math.max(1, sequenceWeeks(merged.demotion), sequenceWeeks(merged.promotion)));
    const first = addCalendarDays(weekEnding, -7 * span);
    const candidate: VsDailyPolicyVersion = { ...merged, version: 1, effectiveWeek: first };
    const weeks = complianceWeeks(first, weekEnding);
    const external = await prepareExternalEvidence(allianceId, [weekEnding]);
    const { rows } = await computeComplianceRows(getDb(), allianceId, weeks, external, { policiesOverride: [candidate] });
    return NextResponse.json({
      weekEnding,
      rows: rows.filter((row) => row.weekEnding === weekEnding).map((row) => ({
        memberId: row.memberId,
        memberName: row.memberName,
        currentRank: row.memberSnapshot.currentRank,
        outcome: row.evaluation.outcome,
        counts: row.evaluation.counts ?? null,
        recommendationKind: row.evaluation.recommendation.kind,
        recommendationTargetRank: row.evaluation.recommendation.targetRank,
        signal: row.evaluation.signal ?? null,
      })),
    });
  } catch (error) {
    return complianceErrorResponse(error);
  }
}
