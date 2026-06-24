import { NextResponse } from "next/server";

import {
  dismissAllReminderItems,
  dismissReminderItem,
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
    return NextResponse.json({ items: [] });
  }

  const items = await loadReminderInboxForUser({
    hqUserId: session.hqUserId,
    allianceId,
    permissions: ctx.permissions,
    includeDismissed: false,
  });

  return NextResponse.json({
    items: items.map((item) => ({
      ...item,
      createdAt: item.createdAt.toISOString(),
    })),
  });
}

export async function POST(request: Request) {
  const session = await getOrCreateSession();
  const ctx = await getRbacContext(session.id);
  if (!ctx?.permissions.has("inbox:read")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!session.hqUserId || !session.currentAllianceId) {
    return NextResponse.json({ error: "No alliance context" }, { status: 400 });
  }

  const body = (await request.json()) as { action?: string };
  if (body.action === "dismiss_all") {
    const dismissed = await dismissAllReminderItems(
      session.hqUserId,
      session.currentAllianceId,
      ctx.permissions,
    );
    return NextResponse.json({ ok: true, dismissed });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
