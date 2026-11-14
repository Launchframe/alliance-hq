import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { z } from "zod";

import {
  previewScoreboardMemberCreates,
  scoreboardMemberActionFailure,
} from "@/lib/members/scoreboard-member-actions.server";
import { requireAlliancePermission } from "@/lib/rbac/require-permission";
import { requireApiSession } from "@/lib/session";
import {
  canOfferScoreboardMemberActionsForAlliance,
  loadScoreboardReviewPreferences,
} from "@/lib/video/scoreboard-review-preferences.server";
import {
  isBankDepositSlipHistoryTarget,
  isMemberRosterVideoTarget,
} from "@/lib/video/score-targets";
import {
  resolveVideoJobAccess,
  videoJobAccessErrorResponse,
} from "@/lib/video/video-job-access.server";
import { resolveHqAllianceIdFromStoredAllianceId } from "@/lib/video/video-job-alliance.server";

type Props = { params: Promise<{ jobId: string }> };

const bodySchema = z.object({
  rows: z
    .array(
      z.object({
        id: z.string().min(1),
        confirmedName: z.string().min(1).max(120),
      }),
    )
    .min(1)
    .max(200),
});

export async function POST(request: Request, { params }: Props) {
  try {
    const session = await requireApiSession();
    if (session instanceof NextResponse) return session;

    const { jobId } = await params;
    const access = await resolveVideoJobAccess(jobId, session.id, "mutate");
    if (!access.ok) {
      return videoJobAccessErrorResponse(access);
    }
    const job = access.job;
    const scoreTargetId = job.scoreTarget ?? job.category ?? "";
    if (
      isMemberRosterVideoTarget(scoreTargetId) ||
      isBankDepositSlipHistoryTarget(scoreTargetId)
    ) {
      return NextResponse.json(
        { error: "Scoreboard member actions are only for score reviews." },
        { status: 400 },
      );
    }

    const allianceId = await resolveHqAllianceIdFromStoredAllianceId(
      job.allianceId,
    );
    if (!allianceId) {
      return NextResponse.json(
        { error: "Alliance context missing on job." },
        { status: 400 },
      );
    }
    if (!job.parseSessionId) {
      return NextResponse.json(
        { error: "Job is not ready for member actions." },
        { status: 400 },
      );
    }

    const offerAccess = await canOfferScoreboardMemberActionsForAlliance(
      session.id,
      allianceId,
    );
    if (!offerAccess.canOffer) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const forbidden = await requireAlliancePermission(
      session.id,
      allianceId,
      "members:write",
    );
    if (forbidden) return forbidden;

    const preferences = await loadScoreboardReviewPreferences(
      offerAccess.hqUserId,
    );
    if (!preferences.offerCreate) {
      return NextResponse.json(
        { error: "Creating members from scoreboards is turned off." },
        { status: 403 },
      );
    }

    const body = bodySchema.parse(await request.json());
    const result = await previewScoreboardMemberCreates({
      sessionId: session.id,
      allianceId,
      parseSessionId: job.parseSessionId,
      rows: body.rows,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid scoreboard member preview." },
        { status: 400 },
      );
    }
    const { jobId } = await params;
    const t = await getTranslations("videoReview");
    const mapped = scoreboardMemberActionFailure(error, jobId, {
      nameConflict: t("scoreboardMemberNameConflict"),
    });
    if (mapped) {
      return NextResponse.json(mapped.body, { status: mapped.status });
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to preview scoreboard member creates.",
      },
      { status: 500 },
    );
  }
}
