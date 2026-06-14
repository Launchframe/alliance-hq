import { NextResponse } from "next/server";

import { isValidBaseVr } from "@/lib/vr/validation";
import {
  listFlaggedSeasonVr,
  officerOverrideSeasonVr,
  resolveSeasonKey,
} from "@/lib/vr/repository";
import { getOrCreateSession } from "@/lib/session";
import { requireSessionPermission } from "@/lib/rbac/require-permission";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getOrCreateSession();
  const denied = await requireSessionPermission(session.id, "members:write");
  if (denied) return denied;

  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId || !session.hqUserId) {
    return NextResponse.json({ error: "No alliance selected." }, { status: 400 });
  }

  const seasonKey = await resolveSeasonKey(allianceId);
  const flagged = await listFlaggedSeasonVr(allianceId, seasonKey);
  return NextResponse.json({ seasonKey, flagged });
}

export async function POST(request: Request) {
  const session = await getOrCreateSession();
  const denied = await requireSessionPermission(session.id, "members:write");
  if (denied) return denied;

  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId || !session.hqUserId) {
    return NextResponse.json({ error: "No alliance selected." }, { status: 400 });
  }

  const body = (await request.json()) as {
    ashedMemberId?: string;
    baseVr?: number;
    reason?: string;
  };
  const ashedMemberId = body.ashedMemberId?.trim();
  const baseVr = body.baseVr;
  const reason = body.reason?.trim() || "officer correction";

  if (!ashedMemberId || baseVr == null || !isValidBaseVr(baseVr)) {
    return NextResponse.json({ error: "Invalid override payload." }, { status: 400 });
  }

  const seasonKey = await resolveSeasonKey(allianceId);
  await officerOverrideSeasonVr({
    allianceId,
    ashedMemberId,
    seasonKey,
    baseVr,
    hqUserId: session.hqUserId,
    reason,
  });

  return NextResponse.json({ ok: true });
}
