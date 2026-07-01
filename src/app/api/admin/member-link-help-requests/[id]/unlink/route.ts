import { NextResponse } from "next/server";
import { z } from "zod";

import { unlinkHqMemberLinkBreakGlass } from "@/lib/member-link/member-link-help-review.server";
import { requirePlatformMaintainer } from "@/lib/rbac/require-permission";
import { getOrCreateSession } from "@/lib/session";

const bodySchema = z.object({
  targetAshedMemberId: z.string().trim().min(1),
  notifiedClaimant: z.literal(true),
});

type Props = {
  params: Promise<{ id: string }>;
};

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: Props) {
  const session = await getOrCreateSession();
  const denied = await requirePlatformMaintainer(session.id);
  if (denied) return denied;

  if (!session.hqUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const result = await unlinkHqMemberLinkBreakGlass({
    requestId: id,
    targetAshedMemberId: body.targetAshedMemberId,
    resolvedByHqUserId: session.hqUserId,
    sessionId: session.id,
    notifiedClaimant: body.notifiedClaimant,
  });

  if (!result.ok) {
    return NextResponse.json(result, { status: 400 });
  }

  return NextResponse.json(result);
}
