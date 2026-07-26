import { NextResponse } from "next/server";

import { readSessionId } from "@/lib/session";
import { requirePlatformMaintainer } from "@/lib/rbac/require-permission";
import { loadVideoLearningOfficerDetail } from "@/lib/video/video-hygiene-learning.server";

type RouteContext = { params: Promise<{ hqUserId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const denied = await requirePlatformMaintainer(sessionId);
  if (denied) return denied;

  const { hqUserId } = await context.params;
  if (!hqUserId) {
    return NextResponse.json({ error: "Missing hqUserId" }, { status: 400 });
  }

  const url = new URL(request.url);
  const days = Number(url.searchParams.get("days") ?? "30");
  const data = await loadVideoLearningOfficerDetail({
    hqUserId,
    daysRaw: days,
  });
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(data);
}
