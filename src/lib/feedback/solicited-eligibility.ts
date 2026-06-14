import { and, count, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { writeAuditLog } from "@/lib/bff/audit";
import { getDb, schema } from "@/lib/db";
import type { SurveyFeedbackSource } from "@/lib/feedback/constants";

export async function countCompletedVideoJobsForUser(
  hqUserId: string,
): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ value: count() })
    .from(schema.videoJobs)
    .where(
      and(
        eq(schema.videoJobs.hqUserId, hqUserId),
        eq(schema.videoJobs.status, "complete"),
      ),
    );
  return Number(row?.value ?? 0);
}

export function resolveSolicitedSource(
  completedCount: number,
): SurveyFeedbackSource | null {
  if (completedCount === 1) {
    return "solicited_first_upload";
  }
  if (completedCount === 3) {
    return "solicited_third_upload";
  }
  return null;
}

export async function hasExistingSolicitedFeedback({
  hqUserId,
  videoJobId,
  source,
}: {
  hqUserId: string;
  videoJobId: string;
  source: SurveyFeedbackSource;
}): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select({ id: schema.surveyFeedback.id })
    .from(schema.surveyFeedback)
    .where(
      and(
        eq(schema.surveyFeedback.hqUserId, hqUserId),
        eq(schema.surveyFeedback.videoJobId, videoJobId),
        eq(schema.surveyFeedback.source, source),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function awardTranslationCommendations(hqUserId: string) {
  const db = getDb();
  const [appliedRow] = await db
    .select({ value: count() })
    .from(schema.translationCorrectionReports)
    .where(
      and(
        eq(schema.translationCorrectionReports.hqUserId, hqUserId),
        eq(schema.translationCorrectionReports.status, "applied"),
      ),
    );
  const appliedCount = Number(appliedRow?.value ?? 0);

  const commendations = await db
    .select()
    .from(schema.hqPlatformCommendations)
    .where(
      and(
        eq(schema.hqPlatformCommendations.active, 1),
        eq(
          schema.hqPlatformCommendations.thresholdType,
          "applied_translation_count",
        ),
      ),
    );

  const awarded: string[] = [];

  for (const commendation of commendations) {
    if (appliedCount < commendation.thresholdValue) {
      continue;
    }

    const insertResult = await db
      .insert(schema.hqUserPlatformCommendations)
      .values({
        id: nanoid(16),
        hqUserId,
        commendationId: commendation.id,
        awardedAt: new Date(),
        metadata: { appliedCount },
      })
      .onConflictDoNothing({
        target: [
          schema.hqUserPlatformCommendations.hqUserId,
          schema.hqUserPlatformCommendations.commendationId,
        ],
      })
      .returning({ id: schema.hqUserPlatformCommendations.id });

    if (insertResult.length > 0) {
      awarded.push(commendation.slug);
      await writeAuditLog({
        sessionId: null,
        allianceId: null,
        hqUserId,
        action: "commendation.awarded",
        resourceType: "platform_commendation",
        resourceName: commendation.slug,
        resourceId: commendation.id,
        metadata: { appliedCount },
      });
    }
  }

  return { appliedCount, awarded };
}

export async function getSolicitedEligibility({
  hqUserId,
  videoJobId,
}: {
  hqUserId: string;
  videoJobId: string;
}) {
  const completedCount = await countCompletedVideoJobsForUser(hqUserId);
  const source = resolveSolicitedSource(completedCount);
  if (!source) {
    return {
      showSolicitedFeedback: false as const,
      completedUploadCount: completedCount,
    };
  }

  const exists = await hasExistingSolicitedFeedback({
    hqUserId,
    videoJobId,
    source,
  });

  return {
    showSolicitedFeedback: !exists,
    solicitedSource: source,
    completedUploadCount: completedCount,
  };
}
