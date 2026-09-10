import { NextResponse } from "next/server";

import {
  OFFICER_INTEL_READ_PERMISSION,
  OFFICER_INTEL_WRITE_PERMISSION,
} from "@/lib/rbac/constants";
import { requireSessionPermission } from "@/lib/rbac/require-permission";
import { requireApiSession } from "@/lib/session";

export async function requireOfficerIntelAllianceContext() {
  const sessionOrError = await requireApiSession();
  if (sessionOrError instanceof NextResponse) {
    return { error: sessionOrError };
  }

  const session = sessionOrError;
  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId) {
    return {
      error: NextResponse.json(
        { error: "No alliance context" },
        { status: 400 },
      ),
    };
  }

  return { sessionId: session.id, session, allianceId };
}

export async function requireOfficerIntelRead(sessionId: string) {
  return requireSessionPermission(sessionId, OFFICER_INTEL_READ_PERMISSION);
}

export async function requireOfficerIntelWrite(sessionId: string) {
  return requireSessionPermission(sessionId, OFFICER_INTEL_WRITE_PERMISSION);
}
