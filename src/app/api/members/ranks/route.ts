import { NextResponse } from "next/server";

import { validateBulkMemberRankInput } from "@/lib/members/bulk-rank-update.shared";
import { applyBulkMemberRanks } from "@/lib/members/bulk-rank-update.server";
import { loadAllianceMembers } from "@/lib/members/load";
import { resolveMembersApiContext } from "@/lib/members/members-api-context";
import { getRbacContext, requireSessionPermission } from "@/lib/rbac/require-permission";
import { getOrCreateSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await getOrCreateSession();
  const denied = await requireSessionPermission(session.id, "members:write");
  if (denied) return denied;

  const ctx = await resolveMembersApiContext();
  if (ctx instanceof NextResponse) return ctx;

  const body = (await request.json()) as {
    memberIds?: unknown;
    action?: unknown;
    allianceRank?: unknown;
  };

  const parsed = validateBulkMemberRankInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  let roster;
  try {
    roster = await loadAllianceMembers(session.id);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to load roster.",
      },
      { status: 502 },
    );
  }

  const membersById = new Map(roster.members.map((m) => [m.id, m]));
  const rbac = await getRbacContext(session.id);

  const output = await applyBulkMemberRanks({
    memberIds: parsed.memberIds,
    action: parsed.action,
    allianceRank: parsed.allianceRank,
    membersById,
    ctx,
    recordedByHqUserId: rbac?.hqUserId ?? null,
  });

  const status = output.updated > 0 ? 200 : 502;
  return NextResponse.json(output, { status });
}
