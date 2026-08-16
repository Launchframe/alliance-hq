import { NextResponse } from "next/server";
import { z } from "zod";

import { writeAuditLog } from "@/lib/bff/audit";
import { getRbacContext } from "@/lib/rbac/context";
import { requireAlliancePermission } from "@/lib/rbac/require-permission";
import { requireApiSession } from "@/lib/session";
import {
  applyScoreboardMemberNamesFromReview,
  createScoreboardMembersFromReview,
} from "@/lib/members/scoreboard-member-actions.server";
import {
  canEditScoreboardReviewPreferences,
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
  action: z.enum(["create", "rename"]),
  rowIds: z.array(z.string().min(1)).min(1).max(200),
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

    const rbac = await getRbacContext(session.id);
    if (
      !rbac ||
      !canEditScoreboardReviewPreferences({
        roleName: rbac.roleName,
        isPlatformMaintainer: rbac.isPlatformMaintainer,
      })
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const forbidden = await requireAlliancePermission(
      session.id,
      allianceId,
      "members:write",
    );
    if (forbidden) return forbidden;

    const preferences = await loadScoreboardReviewPreferences(rbac.hqUserId);
    const body = bodySchema.parse(await request.json());
    if (body.action === "create" && !preferences.offerCreate) {
      return NextResponse.json(
        { error: "Creating members from scoreboards is turned off." },
        { status: 403 },
      );
    }
    if (body.action === "rename" && !preferences.offerRename) {
      return NextResponse.json(
        { error: "Updating member names from scoreboards is turned off." },
        { status: 403 },
      );
    }

    const result =
      body.action === "create"
        ? await createScoreboardMembersFromReview({
            sessionId: session.id,
            allianceId,
            parseSessionId: job.parseSessionId,
            rowIds: body.rowIds,
          })
        : await applyScoreboardMemberNamesFromReview({
            sessionId: session.id,
            allianceId,
            parseSessionId: job.parseSessionId,
            rowIds: body.rowIds,
          });

    await writeAuditLog({
      sessionId: session.id,
      allianceId,
      action:
        body.action === "create"
          ? "video.scoreboard_member_create"
          : "video.scoreboard_member_rename",
      resourceType: "alliance_members",
      resourceName: scoreTargetId,
      resourceId: jobId,
      metadata: {
        rowCount: result.rows.length,
        memberCount: result.members.length,
      },
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid scoreboard member action." },
        { status: 400 },
      );
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to update members from the scoreboard.",
      },
      { status: 500 },
    );
  }
}
