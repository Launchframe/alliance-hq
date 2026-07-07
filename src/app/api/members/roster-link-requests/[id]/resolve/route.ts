import { NextResponse } from "next/server";
import { z } from "zod";

import {
  acceptRosterLinkRequest,
  getRosterLinkRequestById,
  rejectRosterLinkRequest,
} from "@/lib/member-link/roster-link-request.server";
import { canReviewMemberLinks } from "@/lib/member-link/invite-onboarding-access.server";
import { loadAllianceMemberOnboardingRow } from "@/lib/member-link/self-service-onboarding.server";
import { getRbacContext } from "@/lib/rbac/context";
import { getAshedConnection, getOrCreateSession } from "@/lib/session";

const bodySchema = z.object({
  action: z.enum(["accept", "reject"]),
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

  const alliance = await loadAllianceMemberOnboardingRow(allianceId);
  const ctx = await getRbacContext(session.id);
  if (!alliance || !ctx || !canReviewMemberLinks(ctx, alliance)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const rosterRequest = await getRosterLinkRequestById(id);
  if (!rosterRequest || rosterRequest.allianceId !== allianceId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (body.action === "reject") {
    const result = await rejectRosterLinkRequest({
      requestId: id,
      resolvedByHqUserId: session.hqUserId,
      sessionId: session.id,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.reason }, { status: 400 });
    }
    return NextResponse.json({ ok: true, action: "reject" });
  }

  const result = await acceptRosterLinkRequest({
    requestId: id,
    resolvedByHqUserId: session.hqUserId,
    sessionId: session.id,
    targetAshedMemberId: body.targetAshedMemberId ?? null,
    ashedConnection: await getAshedConnection(session.id),
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    action: "accept",
    memberName: result.memberName,
  });
}
