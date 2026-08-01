import { NextResponse } from "next/server";

import {
  BattlePlanRevisionConflictError,
  reloadSerializedDashboard,
} from "@/lib/battle-plan/repository.server";
import { getServerCalendarDate } from "@/lib/trains/game-time";
import {
  BATTLE_PLAN_READ_PERMISSION,
  BATTLE_PLAN_WRITE_PERMISSION,
} from "@/lib/rbac/constants";
import { requireSessionPermission } from "@/lib/rbac/require-permission";
import { requireApiSession } from "@/lib/session";
import { sessionHasPermission } from "@/lib/rbac/context";

export const dynamic = "force-dynamic";

export async function handleBattlePlanMutationError(
  error: unknown,
  allianceId: string,
  sessionId: string,
) {
  if (error instanceof BattlePlanRevisionConflictError) {
    const canWrite = await sessionHasPermission(
      sessionId,
      BATTLE_PLAN_WRITE_PERMISSION,
    );
    const dashboard = await reloadSerializedDashboard(
      allianceId,
      canWrite,
      getServerCalendarDate(),
    );
    return NextResponse.json(
      { error: error.message, code: error.code, dashboard },
      { status: 409 },
    );
  }

  if (error instanceof Error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ error: "Unexpected error." }, { status: 500 });
}

export async function requireBattlePlanAllianceContext() {
  const sessionOrError = await requireApiSession();
  if (sessionOrError instanceof NextResponse) {
    return { error: sessionOrError };
  }

  const session = sessionOrError;
  const allianceId = session.currentAllianceId;
  if (!allianceId) {
    return {
      error: NextResponse.json({ error: "No alliance context" }, { status: 400 }),
    };
  }

  return { sessionId: session.id, session, allianceId };
}

export async function requireBattlePlanRead(sessionId: string) {
  return requireSessionPermission(sessionId, BATTLE_PLAN_READ_PERMISSION);
}

export async function requireBattlePlanWrite(sessionId: string) {
  return requireSessionPermission(sessionId, BATTLE_PLAN_WRITE_PERMISSION);
}
