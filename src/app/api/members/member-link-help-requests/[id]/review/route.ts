import { NextResponse } from "next/server";

import { loadMemberLinkHelpRequestReview } from "@/lib/member-link/member-link-help-review.server";
import { requireSessionPermission } from "@/lib/rbac/require-permission";
import { getOrCreateSession } from "@/lib/session";

type Props = {
  params: Promise<{ id: string }>;
};

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: Props) {
  const session = await getOrCreateSession();
  const denied = await requireSessionPermission(session.id, "members:write");
  if (denied) return denied;

  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId) {
    return NextResponse.json({ error: "No alliance selected." }, { status: 400 });
  }

  const { id } = await params;
  const review = await loadMemberLinkHelpRequestReview({
    requestId: id,
    allianceId,
  });

  if (!review) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({
    review: {
      ...review,
      request: {
        ...review.request,
        createdAt: review.request.createdAt.toISOString(),
      },
    },
  });
}
