import { NextResponse } from "next/server";
import { desc, inArray } from "drizzle-orm";

import {
  isoOrNull,
  loadReporterSummariesByIds,
  reporterLabel,
} from "@/lib/admin/feedback-reports";
import { getDb, schema } from "@/lib/db";
import { feedbackErrorResponse } from "@/lib/feedback/api-errors";
import { requirePlatformMaintainer } from "@/lib/rbac/require-permission";
import { readSessionId } from "@/lib/session";

const BUG_STATUSES = ["open", "triaged", "closed", "wontfix"] as const;

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
    const area = searchParams.get("area");

    const db = getDb();
    const rows = await db
      .select()
      .from(schema.userFeedbackReport)
      .orderBy(desc(schema.userFeedbackReport.createdAt))
      .limit(200);
    const filtered = rows.filter((row) => {
      if (status && status !== "all" && row.status !== status) return false;
      if (area && area !== "all" && row.area !== area) return false;
      return true;
    });

    const reportIds = filtered.map((row) => row.id);
    const screenshotRows =
      reportIds.length > 0
        ? await db
            .select({
              reportId: schema.bugReportScreenshot.reportId,
            })
            .from(schema.bugReportScreenshot)
            .where(inArray(schema.bugReportScreenshot.reportId, reportIds))
        : [];

    const screenshotCounts = new Map<string, number>();
    for (const shot of screenshotRows) {
      screenshotCounts.set(
        shot.reportId,
        (screenshotCounts.get(shot.reportId) ?? 0) + 1,
      );
    }

    const reporters = await loadReporterSummariesByIds(
      filtered.map((row) => row.hqUserId).filter(Boolean) as string[],
    );

    return NextResponse.json({
      reports: filtered.map((row) => ({
        id: row.id,
        status: row.status,
        area: row.area,
        severity: row.severity,
        subject: row.subject,
        descriptionPreview: row.description.slice(0, 160),
        pageUrl: row.pageUrl,
        locale: row.locale,
        allianceId: row.allianceId,
        hqUserId: row.hqUserId,
        reporterLabel: reporterLabel(
          row.hqUserId ? reporters.get(row.hqUserId) : undefined,
          row.hqUserId,
        ),
        screenshotCount: screenshotCounts.get(row.id) ?? 0,
        hasConsoleLogs: Boolean(row.consoleLogs?.trim()),
        createdAt: isoOrNull(row.createdAt),
      })),
      statuses: BUG_STATUSES,
    });
  } catch {
    return feedbackErrorResponse("Load failed");
  }
}
