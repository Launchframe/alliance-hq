import { NextResponse } from "next/server";

import { resolveMembersApiContext } from "@/lib/members/members-api-context";
import { requireSessionPermission } from "@/lib/rbac/require-permission";
import { getOrCreateSession } from "@/lib/session";
import { enforceVsComplianceTaskOnComplete } from "@/lib/vs-compliance/vs-compliance-enforcement.server";
import {
  findComplianceEventById,
  markVsComplianceEventComplete,
} from "@/lib/vs-compliance/repository.server";
import { loadVsMembershipSettings } from "@/lib/vs-compliance/vs-membership-settings.server";
import { deactivateVsComplianceInboxItem } from "@/lib/vs-compliance/vs-compliance-inbox.server";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

/**
 * Apply the recommended VS enforcement (demote or kick), then close the task.
 */
export async function POST(_request: Request, { params }: Props) {
  const session = await getOrCreateSession();
  const denied = await requireSessionPermission(session.id, "members:write");
  if (denied) return denied;

  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId || !session.hqUserId) {
    return NextResponse.json({ error: "No alliance selected." }, { status: 400 });
  }

  const membersCtx = await resolveMembersApiContext();
  if (membersCtx instanceof NextResponse) return membersCtx;

  const { id } = await params;
  const existing = await findComplianceEventById({ allianceId, eventId: id });
  if (!existing || existing.officerTaskStatus !== "open") {
    return NextResponse.json(
      { error: "Task not found or already resolved." },
      { status: 404 },
    );
  }

  const settings = await loadVsMembershipSettings(allianceId, true);

  try {
    await enforceVsComplianceTaskOnComplete({
      event: existing,
      allianceId,
      hqUserId: session.hqUserId,
      missStrikesBeforeKick: settings.missStrikesBeforeKick,
      membersCtx,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Could not apply enforcement.",
      },
      { status: 502 },
    );
  }

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
