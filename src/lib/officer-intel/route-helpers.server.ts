import { NextResponse } from "next/server";

import { getOrCreateSession, readSessionId } from "@/lib/session";
import {
  OFFICER_INTEL_READ_PERMISSION,
  OFFICER_INTEL_WRITE_PERMISSION,
} from "@/lib/rbac/constants";
import { requireSessionPermission } from "@/lib/rbac/require-permission";

export async function requireOfficerIntelAllianceContext() {
  const sessionId = await readSessionId();
  if (!sessionId) {
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const session = await getOrCreateSession();
  const allianceId = session.currentAllianceId;
  if (!allianceId) {
    return {
      error: NextResponse.json(
        { error: "No alliance context" },
        { status: 400 },
      ),
    };
  }

  return { sessionId, session, allianceId };
}

export async function requireOfficerIntelRead(sessionId: string) {
  return requireSessionPermission(sessionId, OFFICER_INTEL_READ_PERMISSION);
}

export async function requireOfficerIntelWrite(sessionId: string) {
  return requireSessionPermission(sessionId, OFFICER_INTEL_WRITE_PERMISSION);
}
