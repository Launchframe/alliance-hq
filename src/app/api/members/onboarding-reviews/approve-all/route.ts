import { NextResponse } from "next/server";

import {
  approveAllOnboardingReviews,
  canSessionReviewOnboardingLinks,
} from "@/lib/member-link/onboarding-review.server";
import { getOrCreateSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST() {
  const session = await getOrCreateSession();
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
  });

  return NextResponse.json({ ok: true, count });
}
