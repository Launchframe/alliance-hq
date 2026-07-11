import "server-only";

import { NextResponse } from "next/server";

import {
  BANK_READ_PERMISSION,
  BANK_WRITE_PERMISSION,
} from "@/lib/rbac/constants";
import { requireSessionPermission } from "@/lib/rbac/require-permission";
import { getOrCreateSession, readSessionId } from "@/lib/session";

export async function requireBankAllianceContext() {
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

export async function requireBankRead(sessionId: string) {
  return requireSessionPermission(sessionId, BANK_READ_PERMISSION);
}

export async function requireBankWrite(sessionId: string) {
  return requireSessionPermission(sessionId, BANK_WRITE_PERMISSION);
}
