import { NextResponse } from "next/server";
import { z } from "zod";

import { requireSessionPermission } from "@/lib/rbac/require-permission";
import { getOrCreateSession } from "@/lib/session";
import { deactivateVsComplianceInboxItem } from "@/lib/vs-compliance/vs-compliance-inbox.server";
import { waiveVsComplianceEvent } from "@/lib/vs-compliance/repository.server";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

type Props = { params: Promise<{ id: string }> };

/** Officer excuses a miss without a matching time-off entry — reason required. */
export async function POST(request: Request, { params }: Props) {
  const session = await getOrCreateSession();
  const denied = await requireSessionPermission(session.id, "members:write");
  if (denied) return denied;

  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId || !session.hqUserId) {
    return NextResponse.json({ error: "No alliance selected." }, { status: 400 });
  }

  const { id } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "A waive reason is required." },
      { status: 400 },
    );
  }

  const event = await waiveVsComplianceEvent({
    allianceId,
    eventId: id,
    hqUserId: session.hqUserId,
    reason: parsed.data.reason,
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
