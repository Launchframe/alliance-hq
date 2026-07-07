import { NextResponse } from "next/server";

import { listAllianceSetupRequestsForAdmin } from "@/lib/alliance/alliance-setup-request.server";
import { requirePlatformMaintainer } from "@/lib/rbac/require-permission";
import { readSessionId } from "@/lib/session";

/** GET /api/admin/alliance-setup-requests — list setup requests for maintainers. */
export async function GET(request: Request) {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const denied = await requirePlatformMaintainer(sessionId);
  if (denied) return denied;

  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status")?.trim() || "open";
  const status =
    statusParam === "fulfilled" ||
    statusParam === "dismissed" ||
    statusParam === "open"
      ? statusParam
      : "open";

  const requests = await listAllianceSetupRequestsForAdmin(status);

  return NextResponse.json({
    ok: true,
    requests: requests.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
  });
}
