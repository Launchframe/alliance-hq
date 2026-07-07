import { NextResponse } from "next/server";
import { z } from "zod";

import {
  approveOnboardingReview,
  canSessionReviewOnboardingLinks,
  dismissOnboardingReview,
  getOnboardingReviewById,
  mergeOnboardingReview,
} from "@/lib/member-link/onboarding-review.server";
import { getOrCreateSession } from "@/lib/session";

const bodySchema = z.object({
  action: z.enum(["approve", "merge", "dismiss"]),
  targetAshedMemberId: z.string().trim().min(1).nullable().optional(),
});

type Props = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, { params }: Props) {
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

  const { id } = await params;
  const review = await getOnboardingReviewById(id);
  if (!review || review.allianceId !== allianceId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (body.action === "dismiss") {
    const result = await dismissOnboardingReview({
      reviewId: id,
      allianceId,
      resolvedByHqUserId: session.hqUserId,
      sessionId: session.id,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.reason }, { status: 400 });
    }
    return NextResponse.json({ ok: true, action: "dismiss" });
  }

  if (body.action === "approve") {
    const result = await approveOnboardingReview({
      reviewId: id,
      allianceId,
      resolvedByHqUserId: session.hqUserId,
      sessionId: session.id,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.reason }, { status: 400 });
    }
    return NextResponse.json({ ok: true, action: "approve" });
  }

  if (!body.targetAshedMemberId) {
    return NextResponse.json({ error: "target_required" }, { status: 400 });
  }

  const result = await mergeOnboardingReview({
    reviewId: id,
    allianceId,
    targetAshedMemberId: body.targetAshedMemberId,
    resolvedByHqUserId: session.hqUserId,
    sessionId: session.id,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 400 });
  }

  return NextResponse.json({ ok: true, action: "merge" });
}
