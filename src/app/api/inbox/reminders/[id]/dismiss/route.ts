import { NextResponse } from "next/server";

import { dismissReminderItemForAlliance } from "@/lib/eur/satisfaction";
import { getRbacContext } from "@/lib/rbac/require-permission";
import { getOrCreateSession } from "@/lib/session";

type Props = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Props) {
  const session = await getOrCreateSession();
  const ctx = await getRbacContext(session.id);
  if (!ctx?.permissions.has("inbox:read")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!session.hqUserId || !session.currentAllianceId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const dismissed = await dismissReminderItemForAlliance(
    session.hqUserId,
    id,
    session.currentAllianceId,
  );
  if (!dismissed) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
