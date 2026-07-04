import { NextResponse } from "next/server";

import {
  formatInstituteLevelValidationError,
  validateInstituteLevelForSeason,
} from "@/lib/vr/validation";
import {
  listFlaggedSeasonVr,
  officerOverrideSeasonVr,
  resolveSeasonKey,
} from "@/lib/vr/repository";
import { loadAllianceMembersForBot } from "@/lib/vr/member-roster";
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
  const [flagged, members] = await Promise.all([
    listFlaggedSeasonVr(allianceId, seasonKey),
    loadAllianceMembersForBot(allianceId),
  ]);
  return NextResponse.json({
    seasonKey,
    flagged,
    members: members.map((m) => ({
      id: m.id,
      current_name: m.current_name,
      previous_names: m.previous_names ?? [],
    })),
  });
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
    instituteLevel?: number;
    reason?: string;
  };
  const ashedMemberId = body.ashedMemberId?.trim();
  const instituteLevel = body.instituteLevel;
  const reason = body.reason?.trim() || "officer correction";

  if (!ashedMemberId || instituteLevel == null || !Number.isInteger(instituteLevel)) {
    return NextResponse.json({ error: "Invalid override payload." }, { status: 400 });
  }

  const seasonKey = await resolveSeasonKey(allianceId);
  const validated = validateInstituteLevelForSeason(seasonKey, instituteLevel);
  if (!validated.ok) {
    return NextResponse.json(
      { error: formatInstituteLevelValidationError(validated) },
      { status: 400 },
    );
  }

  await officerOverrideSeasonVr({
    allianceId,
    ashedMemberId,
    seasonKey,
    baseVr: validated.baseVr,
    instituteLevel: validated.instituteLevel,
    hqUserId: session.hqUserId,
    reason,
  });

  return NextResponse.json({
    ok: true,
    instituteLevel: validated.instituteLevel,
    baseVr: validated.baseVr,
  });
}
