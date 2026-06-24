import { NextResponse } from "next/server";

import {
  countActiveRemindersForUser,
  loadReminderInboxForUser,
} from "@/lib/eur/satisfaction";
import { getRbacContext } from "@/lib/rbac/require-permission";
import { getOrCreateSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getOrCreateSession();
  const ctx = await getRbacContext(session.id);
  if (!ctx?.permissions.has("inbox:read")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const allianceId = session.currentAllianceId;
  if (!allianceId || !session.hqUserId) {
    return NextResponse.json({ count: 0, items: [] });
  }

  const count = await countActiveRemindersForUser({
    hqUserId: session.hqUserId,
    allianceId,
    permissions: ctx.permissions,
  });

  return NextResponse.json({ count });
}
