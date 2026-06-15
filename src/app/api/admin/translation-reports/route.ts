import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";

import {
  isoOrNull,
  loadReporterSummariesByIds,
  reporterLabel,
} from "@/lib/admin/feedback-reports";
import { getDb, schema } from "@/lib/db";
import { feedbackErrorResponse } from "@/lib/feedback/api-errors";
import { readSessionId } from "@/lib/session";
import { requirePlatformMaintainer } from "@/lib/rbac/require-permission";

export async function GET(request: Request) {
  try {
    const sessionId = await readSessionId();
    if (!sessionId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const forbidden = await requirePlatformMaintainer(sessionId);
    if (forbidden) return forbidden;

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");

    const db = getDb();
    const rows = status
      ? await db
          .select()
          .from(schema.translationCorrectionReports)
          .where(eq(schema.translationCorrectionReports.status, status))
          .orderBy(desc(schema.translationCorrectionReports.createdAt))
          .limit(200)
      : await db
          .select()
          .from(schema.translationCorrectionReports)
          .orderBy(desc(schema.translationCorrectionReports.createdAt))
          .limit(200);

    const reporters = await loadReporterSummariesByIds([
      ...rows.map((row) => row.hqUserId),
      ...rows.map((row) => row.reviewedBy).filter(Boolean) as string[],
    ]);

    return NextResponse.json({
      reports: rows.map((row) => ({
        id: row.id,
        locale: row.locale,
        i18nKey: row.i18nKey,
        candidateKeys: row.candidateKeys ?? [],
        displayedText: row.displayedText,
        suggestedTranslation: row.suggestedTranslation,
        pagePath: row.pagePath,
        status: row.status,
        hqUserId: row.hqUserId,
        reporterLabel: reporterLabel(
          reporters.get(row.hqUserId),
          row.hqUserId,
        ),
        reviewedBy: row.reviewedBy,
        reviewerLabel: reporterLabel(
          row.reviewedBy ? reporters.get(row.reviewedBy) : undefined,
          row.reviewedBy,
        ),
        reviewedAt: isoOrNull(row.reviewedAt),
        createdAt: isoOrNull(row.createdAt),
        adminNotes: row.adminNotes,
      })),
    });
  } catch {
    return feedbackErrorResponse("Load failed");
  }
}
