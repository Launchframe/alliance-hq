import { NextResponse } from "next/server";

import { loadWeekSchedulePage } from "@/lib/trains/load-dashboard";
import { getOrCreateSession } from "@/lib/session";
import { requireSessionPermission } from "@/lib/rbac/require-permission";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getOrCreateSession();
  const denied = await requireSessionPermission(session.id, "scores:read");
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const weekStartParam = searchParams.get("weekStart")?.trim();
  if (!weekStartParam) {
    return NextResponse.json(
      { error: "weekStart query parameter is required." },
      { status: 400 },
    );
  }

  const payload = await loadWeekSchedulePage(session.id, weekStartParam);
  if (!payload) {
    return NextResponse.json({ error: "Could not load week schedule." }, { status: 400 });
  }

  return NextResponse.json(payload);
}
