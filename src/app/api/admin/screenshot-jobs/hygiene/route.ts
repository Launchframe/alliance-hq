import { NextResponse } from "next/server";

import { loadScreenshotHygieneFleetKpis } from "@/lib/ocr/screenshot-hygiene-rewards.server";
import { requirePlatformMaintainer } from "@/lib/rbac/require-permission";
import { readSessionId } from "@/lib/session";

export async function GET(request: Request) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const denied = await requirePlatformMaintainer(sessionId);
  if (denied) return denied;

  const url = new URL(request.url);
  const source = url.searchParams.get("source") ?? undefined;
  const lookbackDays = Number(url.searchParams.get("lookbackDays") ?? "30");

  const kpis = await loadScreenshotHygieneFleetKpis({
    source: source && source !== "all" ? source : undefined,
    lookbackDays: Number.isFinite(lookbackDays) ? lookbackDays : 30,
  });

  return NextResponse.json({ kpis });
}
