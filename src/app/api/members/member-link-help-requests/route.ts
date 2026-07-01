import { NextResponse } from "next/server";

import {
  listMemberLinkHelpRequestsForAlliance,
  type MemberLinkHelpStatus,
} from "@/lib/member-link/member-link-help-queue.server";
import { requireSessionPermission } from "@/lib/rbac/require-permission";
import { getOrCreateSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getOrCreateSession();
  const denied = await requireSessionPermission(session.id, "members:write");
  if (denied) return denied;

  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId) {
    return NextResponse.json({ error: "No alliance selected." }, { status: 400 });
  }

  const url = new URL(request.url);
  const status = (url.searchParams.get("status") ?? "open") as MemberLinkHelpStatus;

  const requests = await listMemberLinkHelpRequestsForAlliance(allianceId, status);

  return NextResponse.json({
    requests: requests.map((requestRow) => {
      const { hqUserId, ...row } = requestRow;
      void hqUserId;
      return {
        ...row,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
    }),
  });
}
