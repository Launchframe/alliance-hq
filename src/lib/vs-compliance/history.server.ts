import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { VS_COMPLIANCE_READ_PERMISSION } from "@/lib/rbac/constants";
import { requireVsComplianceAccess } from "./access.server";
import { VsComplianceError, type VsComplianceHistory } from "./types.shared";

export async function loadComplianceHistory(sessionId: string, allianceId: string, eventId: string): Promise<VsComplianceHistory> {
  await requireVsComplianceAccess(sessionId, allianceId, VS_COMPLIANCE_READ_PERMISSION);
  const db = getDb();
  const [event] = await db.select({ id: schema.vsComplianceEvaluations.id, memberId: schema.vsComplianceEvaluations.memberId, memberName: schema.vsComplianceEvaluations.memberName, weekEnding: schema.vsComplianceEvaluations.weekEnding })
    .from(schema.vsComplianceEvaluations).where(and(eq(schema.vsComplianceEvaluations.allianceId, allianceId), eq(schema.vsComplianceEvaluations.id, eventId))).limit(1);
  if (!event) throw new VsComplianceError("not_found", 404);
  const actions = await db.select({
    id: schema.vsComplianceActions.id, actorId: schema.vsComplianceActions.actorId, actorName: schema.hqUsers.displayName,
    kind: schema.vsComplianceActions.kind, expectedRank: schema.vsComplianceActions.expectedRank, targetRank: schema.vsComplianceActions.targetRank,
    reason: schema.vsComplianceActions.reason, recordedAt: schema.vsComplianceActions.recordedAt,
    syncStatus: schema.vsComplianceSyncJobs.status, supersededAt: schema.vsComplianceSyncJobs.supersededAt,
  }).from(schema.vsComplianceActions)
    .leftJoin(schema.hqUsers, eq(schema.hqUsers.id, schema.vsComplianceActions.actorId))
    .leftJoin(schema.vsComplianceSyncJobs, and(eq(schema.vsComplianceSyncJobs.allianceId, allianceId), eq(schema.vsComplianceSyncJobs.actionId, schema.vsComplianceActions.id)))
    .where(and(eq(schema.vsComplianceActions.allianceId, allianceId), eq(schema.vsComplianceActions.eventId, eventId), eq(schema.vsComplianceActions.memberId, event.memberId)))
    .orderBy(asc(schema.vsComplianceActions.recordedAt), asc(schema.vsComplianceActions.id));
  const reviews = actions.length ? await db.select({ actionId: schema.vsComplianceReviews.actionId, recordedAt: schema.vsComplianceReviews.recordedAt })
    .from(schema.vsComplianceReviews).where(and(eq(schema.vsComplianceReviews.allianceId, allianceId), inArray(schema.vsComplianceReviews.actionId, actions.map((action) => action.id)))).orderBy(asc(schema.vsComplianceReviews.recordedAt)) : [];
  return {
    eventId: event.id, memberId: event.memberId, memberName: event.memberName, weekEnding: event.weekEnding,
    actions: actions.map((action) => ({
      id: action.id, actorId: action.actorId, actorName: action.actorName, kind: action.kind,
      expectedRank: action.expectedRank, targetRank: action.targetRank, reason: action.kind === "waive" ? action.reason : null,
      recordedAt: action.recordedAt.toISOString(), correctionReview: reviews.some((review) => review.actionId === action.id),
      reviewDates: reviews.filter((review) => review.actionId === action.id).map((review) => review.recordedAt.toISOString()),
      syncStatus: action.syncStatus, supersededAt: action.supersededAt?.toISOString() ?? null,
    })),
  };
}
