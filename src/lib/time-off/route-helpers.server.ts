import "server-only";

import { NextResponse } from "next/server";

import { requireApiSession } from "@/lib/session";
import {
  TIME_OFF_READ_PERMISSION,
  TIME_OFF_WRITE_PERMISSION,
} from "@/lib/rbac/constants";
import { requireSessionPermission } from "@/lib/rbac/require-permission";
import { getTranslations } from "next-intl/server";
import { sessionHasPermissionForAlliance } from "@/lib/rbac/context";
import { listLinkedCommanderIdsForHqUser } from "./repository.server";
import type { TimeOffActor } from "./mutations.server";
import { TimeOffError, TIME_OFF_MAX_DAYS, TIME_OFF_MAX_NOTES } from "./workflow.shared";

export async function requireTimeOffAllianceContext() {
  const sessionOrError = await requireApiSession();
  if (sessionOrError instanceof NextResponse) {
    return { error: sessionOrError } as const;
  }

  const session = sessionOrError;
  if (!session.hqUserId) return { error: await timeOffErrorResponse(new TimeOffError("forbidden", 403)) } as const;
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

export async function requireTimeOffActor(): Promise<{ actor: TimeOffActor } | { error: NextResponse }> {
  const context = await requireTimeOffAllianceContext();
  if (context.error) return { error: context.error };
  const { session, allianceId } = context;
  const denied = await requireTimeOffRead(session.id);
  if (denied) return { error: denied };
  if (!session.hqUserId) return { error: await timeOffErrorResponse(new TimeOffError("forbidden", 403)) };
  const [canManageOthers, ownedCommanderIds] = await Promise.all([
    sessionHasPermissionForAlliance(session.id, allianceId, TIME_OFF_WRITE_PERMISSION),
    listLinkedCommanderIdsForHqUser({ allianceId, hqUserId: session.hqUserId }),
  ]);
  return { actor: { allianceId, hqUserId: session.hqUserId, canManageOthers, ownedCommanderIds, refresh: async () => {
    const current = await requireTimeOffActor();
    if ("error" in current) throw new TimeOffError("forbidden", 403);
    return current.actor;
  } } };
}

export async function timeOffErrorResponse(error: unknown) {
  const code = error instanceof TimeOffError ? error.code : "saveUnconfirmed";
  const t = await getTranslations("timeOff.workflow.errors");
  return NextResponse.json({
    code,
    error: t(code, { maxDays: TIME_OFF_MAX_DAYS, maxLength: TIME_OFF_MAX_NOTES }),
  }, { status: error instanceof TimeOffError ? error.status : 500 });
}
