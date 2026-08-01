import { NextResponse } from "next/server";

import {
  approveAllOnboardingReviews,
  canSessionReviewOnboardingLinks,
} from "@/lib/member-link/onboarding-review.server";
import { requireApiSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST() {
  const sessionOrError = await requireApiSession();

  if (sessionOrError instanceof NextResponse) return sessionOrError;

  const session = sessionOrError;
  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId || !session.hqUserId) {
    return NextResponse.json({ error: "No alliance selected." }, { status: 400 });
  }

  const canReview = await canSessionReviewOnboardingLinks({
    sessionId: session.id,
    allianceId,
  });
  if (!canReview) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const count = await approveAllOnboardingReviews({
    allianceId,
    resolvedByHqUserId: session.hqUserId,
    sessionId: session.id,
  });

  return NextResponse.json({ ok: true, count });
}
