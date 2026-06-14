import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { writeAuditLog } from "@/lib/bff/audit";
import { getDb, schema } from "@/lib/db";
import {
  APP_VERSION,
  SURVEY_FEEDBACK_SOURCES,
  type SurveyFeedbackSource,
} from "@/lib/feedback/constants";
import { feedbackErrorResponse } from "@/lib/feedback/api-errors";
import { getOrCreateSession } from "@/lib/session";

type FeedbackBody = {
  feedbackId?: string;
  videoJobId?: string;
  source?: SurveyFeedbackSource;
  isSolicited?: boolean;
  positiveExperience?: boolean;
  feedback?: string;
  outreachConsent?: boolean;
  isComplete?: boolean;
  dismissed?: boolean;
  locale?: string;
  pagePath?: string;
  appVersion?: string;
  browserVersion?: string;
  osVersion?: string;
};

function isSurveySource(value: unknown): value is SurveyFeedbackSource {
  return (
    typeof value === "string" &&
    SURVEY_FEEDBACK_SOURCES.includes(value as SurveyFeedbackSource)
  );
}

export async function POST(request: Request) {
  try {
    const session = await getOrCreateSession();
    if (!session.hqUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as FeedbackBody;
    const db = getDb();
    const now = new Date();
    const source = isSurveySource(body.source)
      ? body.source
      : body.isSolicited
        ? "solicited_first_upload"
        : "unsolicited";

    if (body.videoJobId) {
      const [job] = await db
        .select()
        .from(schema.videoJobs)
        .where(
          and(
            eq(schema.videoJobs.id, body.videoJobId),
            eq(schema.videoJobs.sessionId, session.id),
          ),
        )
        .limit(1);
      if (!job) {
        return NextResponse.json({ error: "Video job not found" }, { status: 404 });
      }
    }

    if (body.feedbackId) {
      const [existing] = await db
        .select()
        .from(schema.surveyFeedback)
        .where(eq(schema.surveyFeedback.id, body.feedbackId))
        .limit(1);

      if (!existing || existing.hqUserId !== session.hqUserId) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }

      if (existing.isComplete === 1) {
        return NextResponse.json({ error: "Feedback already complete" }, { status: 409 });
      }

      await db
        .update(schema.surveyFeedback)
        .set({
          positiveExperience:
            body.positiveExperience != null
              ? body.positiveExperience
                ? 1
                : 0
              : existing.positiveExperience,
          feedback: body.feedback ?? existing.feedback,
          outreachConsent:
            body.outreachConsent != null
              ? body.outreachConsent
                ? 1
                : 0
              : existing.outreachConsent,
          isComplete: body.isComplete ? 1 : existing.isComplete,
          dismissedAt: body.dismissed ? now : existing.dismissedAt,
          updatedAt: now,
        })
        .where(eq(schema.surveyFeedback.id, body.feedbackId));

      return NextResponse.json({ id: body.feedbackId });
    }

    const id = nanoid(16);
    await db.insert(schema.surveyFeedback).values({
      id,
      hqUserId: session.hqUserId,
      allianceId: session.currentAllianceId ?? session.allianceId,
      videoJobId: body.videoJobId ?? null,
      source,
      positiveExperience:
        body.positiveExperience != null
          ? body.positiveExperience
            ? 1
            : 0
          : null,
      feedback: body.feedback ?? null,
      outreachConsent:
        body.outreachConsent != null ? (body.outreachConsent ? 1 : 0) : null,
      isComplete: body.isComplete ? 1 : 0,
      dismissedAt: body.dismissed ? now : null,
      locale: body.locale ?? null,
      pagePath: body.pagePath ?? null,
      appVersion: body.appVersion ?? APP_VERSION,
      browserVersion: body.browserVersion ?? null,
      osVersion: body.osVersion ?? null,
      createdAt: now,
      updatedAt: now,
    });

    await writeAuditLog({
      sessionId: session.id,
      allianceId: session.currentAllianceId ?? session.allianceId,
      hqUserId: session.hqUserId,
      action: "feedback.experience",
      resourceType: "survey_feedback",
      resourceName: source,
      resourceId: id,
      metadata: { videoJobId: body.videoJobId ?? null },
    });

    return NextResponse.json({ id }, { status: 201 });
  } catch {
    return feedbackErrorResponse("Feedback failed");
  }
}
