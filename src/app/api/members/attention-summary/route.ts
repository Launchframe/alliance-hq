import { NextResponse } from "next/server";

import { loadMembersAttentionSummary } from "@/lib/members/members-attention-summary.server";
import { requireSessionPermission } from "@/lib/rbac/require-permission";
import { getOrCreateSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getOrCreateSession();
  const denied = await requireSessionPermission(session.id, "members:write");
  if (denied) return denied;

  const summary = await loadMembersAttentionSummary(session.id);
  return NextResponse.json({ ok: true, summary });
}
