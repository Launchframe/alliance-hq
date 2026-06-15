import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import {
  isoOrNull,
  loadReporterSummariesByIds,
  reporterLabel,
} from "@/lib/admin/feedback-reports";
import { writeAuditLog } from "@/lib/bff/audit";
import { getDb, schema } from "@/lib/db";
import { feedbackErrorResponse } from "@/lib/feedback/api-errors";
import { requirePlatformMaintainer } from "@/lib/rbac/require-permission";
import { readSessionId } from "@/lib/session";

type Props = {
  params: Promise<{ id: string }>;
};

const BUG_STATUSES = ["open", "triaged", "closed", "wontfix"] as const;
type BugStatus = (typeof BUG_STATUSES)[number];

type PatchBody = {
  status?: BugStatus;
};

export async function GET(_request: Request, { params }: Props) {
  try {
    const sessionId = await readSessionId();
    if (!sessionId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const forbidden = await requirePlatformMaintainer(sessionId);
    if (forbidden) return forbidden;

    const { id } = await params;
    const db = getDb();
    const [row] = await db
      .select()
      .from(schema.userFeedbackReport)
      .where(eq(schema.userFeedbackReport.id, id))
      .limit(1);

    if (!row) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const screenshots = await db
      .select({
        id: schema.bugReportScreenshot.id,
        width: schema.bugReportScreenshot.width,
        height: schema.bugReportScreenshot.height,
        capturedAt: schema.bugReportScreenshot.capturedAt,
      })
      .from(schema.bugReportScreenshot)
      .where(eq(schema.bugReportScreenshot.reportId, id));

    const reporters = await loadReporterSummariesByIds(
      row.hqUserId ? [row.hqUserId] : [],
    );

    return NextResponse.json({
      report: {
        id: row.id,
        status: row.status,
        area: row.area,
        severity: row.severity,
        subject: row.subject,
        description: row.description,
        pageUrl: row.pageUrl,
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
        consoleLogs: row.consoleLogs,
        createdAt: isoOrNull(row.createdAt),
        updatedAt: isoOrNull(row.updatedAt),
        screenshots: screenshots.map((shot) => ({
          id: shot.id,
          width: shot.width,
          height: shot.height,
          capturedAt: isoOrNull(shot.capturedAt),
          url: `/api/admin/bug-reports/${id}/screenshots/${shot.id}`,
        })),
      },
    });
  } catch {
    return feedbackErrorResponse("Load failed");
  }
}

export async function PATCH(request: Request, { params }: Props) {
  try {
    const sessionId = await readSessionId();
    if (!sessionId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const forbidden = await requirePlatformMaintainer(sessionId);
    if (forbidden) return forbidden;

    const { id } = await params;
    const body = (await request.json()) as PatchBody;
    if (!body.status || !BUG_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    const db = getDb();
    const [existing] = await db
      .select()
      .from(schema.userFeedbackReport)
      .where(eq(schema.userFeedbackReport.id, id))
      .limit(1);

    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const [session] = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
      .limit(1);

    const now = new Date();
    await db
      .update(schema.userFeedbackReport)
      .set({
        status: body.status,
        updatedAt: now,
      })
      .where(eq(schema.userFeedbackReport.id, id));

    await writeAuditLog({
      sessionId,
      allianceId: existing.allianceId,
      hqUserId: session?.hqUserId ?? null,
      action: "feedback.bug.review",
      resourceType: "user_feedback_report",
      resourceName: body.status,
      resourceId: id,
      metadata: { reporterId: existing.hqUserId },
    });

    return NextResponse.json({ ok: true, status: body.status });
  } catch {
    return feedbackErrorResponse("Update failed");
  }
}
