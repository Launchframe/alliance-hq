import { NextResponse } from "next/server";

import { canReviewMemberLinks } from "@/lib/member-link/invite-onboarding-access.server";
import { listPendingRosterLinkRequests } from "@/lib/member-link/roster-link-resolve.server";
import { loadAllianceMemberOnboardingRow } from "@/lib/member-link/self-service-onboarding.server";
import { getRbacContext } from "@/lib/rbac/context";
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

  const alliance = await loadAllianceMemberOnboardingRow(allianceId);
  const ctx = await getRbacContext(session.id);
  const canReview =
    alliance && ctx ? canReviewMemberLinks(ctx, alliance) : false;

  if (!canReview) {
    return NextResponse.json({ requests: [], canReview: false });
  }

  const requests = await listPendingRosterLinkRequests(allianceId);
  return NextResponse.json({ requests, canReview: true });
}
