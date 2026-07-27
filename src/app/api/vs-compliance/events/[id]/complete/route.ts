import { NextResponse } from "next/server";

import { requireSessionPermission } from "@/lib/rbac/require-permission";
import { getOrCreateSession } from "@/lib/session";
import { deactivateVsComplianceInboxItem } from "@/lib/vs-compliance/vs-compliance-inbox.server";
import { markVsComplianceEventComplete } from "@/lib/vs-compliance/repository.server";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

/**
 * Officer confirms they handled the demotion/kick in-game. HQ never calls
 * confirmMemberRank — this only closes the informational task.
 */
export async function POST(_request: Request, { params }: Props) {
  const session = await getOrCreateSession();
  const denied = await requireSessionPermission(session.id, "members:write");
  if (denied) return denied;

  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId || !session.hqUserId) {
    return NextResponse.json({ error: "No alliance selected." }, { status: 400 });
  }

  const { id } = await params;
  const event = await markVsComplianceEventComplete({
    allianceId,
    eventId: id,
    hqUserId: session.hqUserId,
  });

  if (!event) {
    return NextResponse.json(
      { error: "Task not found or already resolved." },
      { status: 404 },
    );
  }

  await deactivateVsComplianceInboxItem(event.id);

  return NextResponse.json({ ok: true });
}
