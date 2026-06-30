import { NextResponse } from "next/server";

import { loadMemberLinkHelpRequestReview } from "@/lib/member-link/member-link-help-review.server";
import { requirePlatformMaintainer } from "@/lib/rbac/require-permission";
import { getOrCreateSession } from "@/lib/session";

type Props = {
  params: Promise<{ id: string }>;
};

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: Props) {
  const session = await getOrCreateSession();
  const denied = await requirePlatformMaintainer(session.id);
  if (denied) return denied;

  const { id } = await params;
  const review = await loadMemberLinkHelpRequestReview({ requestId: id });

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
