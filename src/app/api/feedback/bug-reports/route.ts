import { NextResponse } from "next/server";
import { nanoid } from "nanoid";

import { writeAuditLog } from "@/lib/bff/audit";
import { getDb, schema } from "@/lib/db";
import { verifyBugReportCaptureSession } from "@/lib/feedback/bug-report-capture-session";
import {
  bugReportStorageKey,
  isAllowedBugReportScreenshotMime,
} from "@/lib/feedback/bug-report-upload";
import {
  APP_VERSION,
  MAX_BUG_REPORT_SCREENSHOTS,
  MAX_BUG_REPORT_SCREENSHOT_BYTES,
  truncateBugReportConsoleLogs,
} from "@/lib/feedback/constants";
import { getOrCreateSession } from "@/lib/session";
import { putObject } from "@/lib/storage";

function formField(form: FormData, key: string): string | undefined {
  const value = form.get(key);
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export async function POST(request: Request) {
  try {
    const session = await getOrCreateSession();
    if (!session.hqUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const form = await request.formData();
    const description = formField(form, "description");
    if (!description?.trim()) {
      return NextResponse.json(
        { error: "Description is required" },
        { status: 400 },
      );
    }

    const screenshots = form
      .getAll("screenshots")
      .filter((entry): entry is File => entry instanceof File);

    if (screenshots.length > MAX_BUG_REPORT_SCREENSHOTS) {
      return NextResponse.json(
        { error: "Too many screenshots" },
        { status: 400 },
      );
    }

    const captureSessionId = formField(form, "captureSessionId");
    const captureSessionToken = formField(form, "captureSessionToken");
    const captureSessionExpiresAt = Number(
      formField(form, "captureSessionExpiresAt") ?? "0",
    );

    if (screenshots.length > 0) {
      const valid = verifyBugReportCaptureSession({
        sessionId: captureSessionId ?? "",
        userId: session.hqUserId,
        expiresAt: captureSessionExpiresAt,
        token: captureSessionToken ?? "",
      });
      if (!valid) {
        return NextResponse.json(
          { error: "Invalid capture session" },
          { status: 400 },
        );
      }
    }

    const allianceId = session.currentAllianceId ?? session.allianceId;
    const reportId = nanoid(16);
    const now = new Date();
    const db = getDb();

    await db.insert(schema.userFeedbackReport).values({
      id: reportId,
      type: "bug",
      status: "open",
      hqUserId: session.hqUserId,
      allianceId: allianceId ?? null,
      subject: formField(form, "subject") ?? null,
      description: description.trim(),
      area: formField(form, "area") ?? null,
      severity: formField(form, "severity")
        ? Number(formField(form, "severity"))
        : null,
      pageUrl: formField(form, "pageUrl") ?? null,
      locale: formField(form, "locale") ?? null,
      appVersion: formField(form, "appVersion") ?? APP_VERSION,
      browserVersion: formField(form, "browserVersion") ?? null,
      osVersion: formField(form, "osVersion") ?? null,
      consoleLogs: truncateBugReportConsoleLogs(formField(form, "consoleLogs")),
      captureSessionId: captureSessionId ?? null,
      createdAt: now,
      updatedAt: now,
    });

    for (let index = 0; index < screenshots.length; index += 1) {
      const file = screenshots[index];
      if (file.size > MAX_BUG_REPORT_SCREENSHOT_BYTES) {
        return NextResponse.json(
          { error: "Screenshot too large" },
          { status: 413 },
        );
      }
      if (!isAllowedBugReportScreenshotMime(file.type)) {
        return NextResponse.json(
          { error: "Invalid screenshot type" },
          { status: 400 },
        );
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const storageKey = bugReportStorageKey({
        reportId,
        allianceId,
        index,
      });
      await putObject(storageKey, buffer);

      const width = Number(formField(form, `screenshotWidth_${index}`) ?? "0");
      const height = Number(formField(form, `screenshotHeight_${index}`) ?? "0");

      await db.insert(schema.bugReportScreenshot).values({
        id: nanoid(16),
        reportId,
        storageKey,
        width: width || null,
        height: height || null,
        capturedAt: now,
      });
    }

    await writeAuditLog({
      sessionId: session.id,
      allianceId: allianceId ?? null,
      hqUserId: session.hqUserId,
      action: "feedback.bug",
      resourceType: "user_feedback_report",
      resourceName: formField(form, "area") ?? "bug",
      resourceId: reportId,
      metadata: { screenshotCount: screenshots.length },
    });

    return NextResponse.json({ id: reportId }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Bug report failed" },
      { status: 500 },
    );
  }
}
