import "server-only";

import { NextResponse } from "next/server";

import { resolveEffectiveHqUserIdForSession } from "@/lib/session";
import { getOrCreateSession } from "@/lib/session";
import { sessionHasActiveMembership } from "@/lib/native-alliance/access";

export async function requireMemberLinkSession() {
  const session = await getOrCreateSession();
  const effectiveHqUserId = await resolveEffectiveHqUserIdForSession(
    session.id,
    session.hqUserId,
  );

  if (!effectiveHqUserId) {
    return {
      error: NextResponse.json(
        { error: "Sign in required.", code: "auth_required" },
        { status: 401 },
      ),
    };
  }

  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId) {
    return {
      error: NextResponse.json(
        { error: "No alliance selected.", code: "no_alliance" },
        { status: 400 },
      ),
    };
  }

  const hasMembership = await sessionHasActiveMembership(session);
  if (!hasMembership) {
    return {
      error: NextResponse.json(
        { error: "Alliance membership required.", code: "forbidden" },
        { status: 403 },
      ),
    };
  }

  return {
    session,
    allianceId,
    hqUserId: effectiveHqUserId,
  };
}
