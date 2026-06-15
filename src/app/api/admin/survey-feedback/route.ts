import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";

import {
  isoOrNull,
  loadReporterSummariesByIds,
  reporterLabel,
} from "@/lib/admin/feedback-reports";
import { getDb, schema } from "@/lib/db";
import { SURVEY_FEEDBACK_SOURCES } from "@/lib/feedback/constants";
import { feedbackErrorResponse } from "@/lib/feedback/api-errors";
import { requirePlatformMaintainer } from "@/lib/rbac/require-permission";
import { readSessionId } from "@/lib/session";

export async function GET(request: Request) {
  try {
    const sessionId = await readSessionId();
    if (!sessionId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const forbidden = await requirePlatformMaintainer(sessionId);
    if (forbidden) return forbidden;

    const { searchParams } = new URL(request.url);
    const source = searchParams.get("source");
    const sentiment = searchParams.get("sentiment");
    const complete = searchParams.get("complete");

    const db = getDb();
    const rows = await db
      .select()
      .from(schema.surveyFeedback)
      .orderBy(desc(schema.surveyFeedback.createdAt))
      .limit(200);

    const filtered = rows.filter((row) => {
      if (source && source !== "all" && row.source !== source) return false;
      if (sentiment === "positive" && row.positiveExperience !== 1) {
        return false;
      }
      if (sentiment === "negative" && row.positiveExperience !== 0) {
        return false;
      }
      if (complete === "complete" && row.isComplete !== 1) return false;
      if (complete === "incomplete" && row.isComplete === 1) return false;
      return true;
    });

    const reporters = await loadReporterSummariesByIds(
      filtered.map((row) => row.hqUserId).filter(Boolean) as string[],
    );

    return NextResponse.json({
      feedback: filtered.map((row) => ({
        id: row.id,
        source: row.source,
        positiveExperience:
          row.positiveExperience === 1
            ? true
            : row.positiveExperience === 0
              ? false
              : null,
        feedback: row.feedback,
        outreachConsent: row.outreachConsent === 1,
        isComplete: row.isComplete === 1,
        dismissedAt: isoOrNull(row.dismissedAt),
        videoJobId: row.videoJobId,
        pagePath: row.pagePath,
        locale: row.locale,
        allianceId: row.allianceId,
        hqUserId: row.hqUserId,
        reporterLabel: reporterLabel(
          row.hqUserId ? reporters.get(row.hqUserId) : undefined,
          row.hqUserId,
        ),
        appVersion: row.appVersion,
        browserVersion: row.browserVersion,
        osVersion: row.osVersion,
        createdAt: isoOrNull(row.createdAt),
        updatedAt: isoOrNull(row.updatedAt),
      })),
      sources: SURVEY_FEEDBACK_SOURCES,
    });
  } catch {
    return feedbackErrorResponse("Load failed");
  }
}
