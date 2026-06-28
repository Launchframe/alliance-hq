import { NextResponse } from "next/server";

import {
  listClaimConflicts,
  type ClaimConflictStatus,
} from "@/lib/member-link/claim-conflict-queue.server";
import { requireSessionPermission } from "@/lib/rbac/require-permission";
import { getOrCreateSession } from "@/lib/session";

const STATUS_VALUES: ClaimConflictStatus[] = ["open", "resolved", "dismissed"];

export async function GET(request: Request) {
  const session = await getOrCreateSession();
  const denied = await requireSessionPermission(session.id, "members:write");
  if (denied) return denied;

  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId) {
    return NextResponse.json({ error: "No alliance selected." }, { status: 400 });
  }

  const statusParam = new URL(request.url).searchParams.get("status");
  const status =
    statusParam && STATUS_VALUES.includes(statusParam as ClaimConflictStatus)
      ? (statusParam as ClaimConflictStatus)
      : "open";

  const rows = await listClaimConflicts({ allianceId, status });

  // Never expose game UID (none is stored) or hqUserId beyond what officers
  // need; surface the claimant handle and bound commander name only.
  return NextResponse.json({
    conflicts: rows.map((row) => ({
      id: row.id,
      ashedMemberId: row.ashedMemberId,
      commanderName: row.commanderName,
      handle: row.handle,
      reason: row.reason,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
    })),
  });
}
