import { NextResponse } from "next/server";

import { readSessionId } from "@/lib/session";
import { requirePlatformMaintainer } from "@/lib/rbac/require-permission";
import { loadVideoLearningFleet } from "@/lib/video/video-hygiene-learning.server";

export async function GET(request: Request) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const denied = await requirePlatformMaintainer(sessionId);
  if (denied) return denied;

  const url = new URL(request.url);
  const days = Number(url.searchParams.get("days") ?? "30");
  const data = await loadVideoLearningFleet(days);
  return NextResponse.json(data);
}
