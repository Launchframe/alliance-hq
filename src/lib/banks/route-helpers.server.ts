import "server-only";

import { NextResponse } from "next/server";

import {
  BANK_READ_PERMISSION,
  BANK_WRITE_PERMISSION,
} from "@/lib/rbac/constants";
import { requireSessionPermission } from "@/lib/rbac/require-permission";
import { requireApiSession } from "@/lib/session";

export async function requireBankAllianceContext() {
  const sessionOrError = await requireApiSession();
  if (sessionOrError instanceof NextResponse) {
    return { error: sessionOrError };
  }

  const session = sessionOrError;
  const allianceId = session.currentAllianceId;
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

export async function requireBankRead(sessionId: string) {
  return requireSessionPermission(sessionId, BANK_READ_PERMISSION);
}

export async function requireBankWrite(sessionId: string) {
  return requireSessionPermission(sessionId, BANK_WRITE_PERMISSION);
}
