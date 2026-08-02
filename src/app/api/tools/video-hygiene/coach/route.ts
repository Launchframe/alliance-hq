import { NextResponse } from "next/server";

import { resolveSessionAllianceId } from "@/lib/alliance/session-memberships";
import { VIDEO_ENQUEUE_PERMISSION } from "@/lib/rbac/constants";
import { requireSessionPermission } from "@/lib/rbac/require-permission";
import { requireApiSession } from "@/lib/session";
import {
  pickVideoHygieneCoachTipForUploader,
  recordCoachDismissed,
  recordCoachShown,
  resolveVideoHygieneCoachTip,
} from "@/lib/video/video-hygiene-coach.server";
import {
  VIDEO_HYGIENE_COACH_TIP_IDS,
  type VideoHygieneCoachTipId,
} from "@/lib/video/video-hygiene-coach.shared";
import { getScoreTarget } from "@/lib/video/score-targets";

function parseTipId(value: unknown): VideoHygieneCoachTipId | null {
  if (typeof value !== "string") return null;
  return (VIDEO_HYGIENE_COACH_TIP_IDS as readonly string[]).includes(value)
    ? (value as VideoHygieneCoachTipId)
    : null;
}

type CoachBody = {
  action?: "shown" | "dismiss";
  scoreTarget?: string;
  tipId?: string;
};

/** Resolve a hygiene coach tip for the signed-in uploader × score target. */
export async function GET(request: Request) {
  const sessionOrError = await requireApiSession();

  if (sessionOrError instanceof NextResponse) return sessionOrError;

  const session = sessionOrError;
  if (!session.hqUserId) {
    return NextResponse.json({ tip: null });
  }

  const denied = await requireSessionPermission(
    session.id,
    VIDEO_ENQUEUE_PERMISSION,
  );
  if (denied) return denied;

  const url = new URL(request.url);
  const scoreTarget = url.searchParams.get("scoreTarget");
  if (!scoreTarget || !getScoreTarget(scoreTarget)) {
    return NextResponse.json({ error: "Invalid scoreTarget" }, { status: 400 });
  }

  const tip = await resolveVideoHygieneCoachTip({
    hqUserId: session.hqUserId,
    scoreTarget,
  });

  return NextResponse.json({ tip });
}

/** Record coach_shown or coach_dismissed for the learning dashboard. */
export async function POST(request: Request) {
  const sessionOrError = await requireApiSession();

  if (sessionOrError instanceof NextResponse) return sessionOrError;

  const session = sessionOrError;
  if (!session.hqUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const denied = await requireSessionPermission(
    session.id,
    VIDEO_ENQUEUE_PERMISSION,
  );
  if (denied) return denied;

  const body = (await request.json()) as CoachBody;
  if (!body.scoreTarget || !getScoreTarget(body.scoreTarget)) {
    return NextResponse.json({ error: "Invalid scoreTarget" }, { status: 400 });
  }
  const tipId = parseTipId(body.tipId);
  if (!tipId) {
    return NextResponse.json({ error: "Invalid tipId" }, { status: 400 });
  }

  const expected = await pickVideoHygieneCoachTipForUploader({
    hqUserId: session.hqUserId,
    scoreTarget: body.scoreTarget,
  });
  if (!expected || expected.tipId !== tipId) {
    return NextResponse.json({ error: "Tip no longer applies" }, { status: 400 });
  }

  const allianceId = resolveSessionAllianceId(session);
  if (body.action === "shown") {
    await recordCoachShown({
      hqUserId: session.hqUserId,
      scoreTarget: body.scoreTarget,
      tipId,
      allianceId,
    });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "dismiss") {
    await recordCoachDismissed({
      hqUserId: session.hqUserId,
      scoreTarget: body.scoreTarget,
      tipId,
      allianceId,
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
