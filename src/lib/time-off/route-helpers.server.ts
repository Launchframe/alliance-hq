import "server-only";

import { NextResponse } from "next/server";

import { requireApiSession } from "@/lib/session";
import {
  TIME_OFF_READ_PERMISSION,
  TIME_OFF_WRITE_PERMISSION,
} from "@/lib/rbac/constants";
import { requireSessionPermission } from "@/lib/rbac/require-permission";

export async function requireTimeOffAllianceContext() {
  const sessionOrError = await requireApiSession();
  if (sessionOrError instanceof NextResponse) {
    return { error: sessionOrError } as const;
  }

  const session = sessionOrError;
  const allianceId = session.currentAllianceId ?? session.allianceId;
  if (!allianceId) {
    return {
      error: NextResponse.json({ error: "No alliance selected." }, { status: 400 }),
    } as const;
  }

  return { sessionId: session.id, session, allianceId } as const;
}

export async function requireTimeOffRead(sessionId: string) {
  return requireSessionPermission(sessionId, TIME_OFF_READ_PERMISSION);
}

export async function requireTimeOffWrite(sessionId: string) {
  return requireSessionPermission(sessionId, TIME_OFF_WRITE_PERMISSION);
}
