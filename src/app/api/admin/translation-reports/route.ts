import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";

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
          .select({
            id: schema.translationCorrectionReports.id,
            locale: schema.translationCorrectionReports.locale,
            i18nKey: schema.translationCorrectionReports.i18nKey,
            displayedText: schema.translationCorrectionReports.displayedText,
            suggestedTranslation:
              schema.translationCorrectionReports.suggestedTranslation,
            pagePath: schema.translationCorrectionReports.pagePath,
            status: schema.translationCorrectionReports.status,
            hqUserId: schema.translationCorrectionReports.hqUserId,
            createdAt: schema.translationCorrectionReports.createdAt,
            adminNotes: schema.translationCorrectionReports.adminNotes,
          })
          .from(schema.translationCorrectionReports)
          .where(eq(schema.translationCorrectionReports.status, status))
          .orderBy(desc(schema.translationCorrectionReports.createdAt))
          .limit(200)
      : await db
          .select({
            id: schema.translationCorrectionReports.id,
            locale: schema.translationCorrectionReports.locale,
            i18nKey: schema.translationCorrectionReports.i18nKey,
            displayedText: schema.translationCorrectionReports.displayedText,
            suggestedTranslation:
              schema.translationCorrectionReports.suggestedTranslation,
            pagePath: schema.translationCorrectionReports.pagePath,
            status: schema.translationCorrectionReports.status,
            hqUserId: schema.translationCorrectionReports.hqUserId,
            createdAt: schema.translationCorrectionReports.createdAt,
            adminNotes: schema.translationCorrectionReports.adminNotes,
          })
          .from(schema.translationCorrectionReports)
          .orderBy(desc(schema.translationCorrectionReports.createdAt))
          .limit(200);

    return NextResponse.json({ reports: rows });
  } catch {
    return feedbackErrorResponse("Load failed");
  }
}
