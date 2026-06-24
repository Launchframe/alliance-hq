import { NextResponse } from "next/server";

import { loadOpsInboxItems } from "@/lib/admin/ops-inbox";
import { requirePlatformMaintainer } from "@/lib/rbac/require-permission";
import { readSessionId } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const denied = await requirePlatformMaintainer(sessionId);
  if (denied) return denied;

  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 100);
  const items = await loadOpsInboxItems(limit);

  return NextResponse.json({
    items: items.map((item) => ({
      ...item,
      createdAt: item.createdAt.toISOString(),
    })),
  });
}
