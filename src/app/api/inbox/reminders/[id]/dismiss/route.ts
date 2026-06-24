import { NextResponse } from "next/server";

import { dismissReminderItem } from "@/lib/eur/satisfaction";
import { getRbacContext } from "@/lib/rbac/require-permission";
import { getOrCreateSession } from "@/lib/session";

type Props = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Props) {
  const session = await getOrCreateSession();
  const ctx = await getRbacContext(session.id);
  if (!ctx?.permissions.has("inbox:read")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!session.hqUserId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  await dismissReminderItem(session.hqUserId, id);
  return NextResponse.json({ ok: true });
}
