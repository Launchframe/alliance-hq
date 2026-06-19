import { NextResponse } from "next/server";

import { loadMonthSchedulePage } from "@/lib/trains/load-dashboard";
import { getOrCreateSession } from "@/lib/session";
import { requireSessionPermission } from "@/lib/rbac/require-permission";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getOrCreateSession();
  const denied = await requireSessionPermission(session.id, "scores:read");
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const monthParam = searchParams.get("month")?.trim();
  if (!monthParam || !/^\d{4}-\d{2}$/.test(monthParam)) {
    return NextResponse.json(
      { error: "month query parameter must be YYYY-MM." },
      { status: 400 },
    );
  }

  const payload = await loadMonthSchedulePage(session.id, monthParam);
  if (!payload) {
    return NextResponse.json(
      { error: "Could not load month schedule." },
      { status: 400 },
    );
  }

  return NextResponse.json(payload);
}
