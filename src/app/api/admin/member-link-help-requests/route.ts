import { NextResponse } from "next/server";

import {
  listMemberLinkHelpRequestsForAdmin,
  type MemberLinkHelpStatus,
} from "@/lib/member-link/member-link-help-queue.server";
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
  const status = (url.searchParams.get("status") ?? "open") as MemberLinkHelpStatus;

  const requests = await listMemberLinkHelpRequestsForAdmin(status);

  return NextResponse.json({
    requests: requests.map(({ hqUserId: _hqUserId, ...row }) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
  });
}
