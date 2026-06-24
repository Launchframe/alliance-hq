import { NextResponse } from "next/server";

import { loadOpsInboxSummary } from "@/lib/admin/ops-inbox";
import { requirePlatformMaintainer } from "@/lib/rbac/require-permission";
import { readSessionId } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const denied = await requirePlatformMaintainer(sessionId);
  if (denied) return denied;

  const summary = await loadOpsInboxSummary();
  return NextResponse.json(summary);
}
