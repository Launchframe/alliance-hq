import { NextResponse } from "next/server";

import {
  canSessionReviewOnboardingLinks,
  listPendingOnboardingReviews,
} from "@/lib/member-link/onboarding-review.server";
import { requireApiSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const sessionOrError = await requireApiSession();

  if (sessionOrError instanceof NextResponse) return sessionOrError;

  const session = sessionOrError;
  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId) {
    return NextResponse.json({ error: "No alliance selected." }, { status: 400 });
  }

  const canReview = await canSessionReviewOnboardingLinks({
    sessionId: session.id,
    allianceId,
  });
  if (!canReview) {
    return NextResponse.json({ reviews: [], canReview: false });
  }

  const reviews = await listPendingOnboardingReviews(allianceId);
  return NextResponse.json({ reviews, canReview: true });
}
