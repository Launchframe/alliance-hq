import { NextResponse } from "next/server";

import { validateBattlePlanSettingsPayload } from "@/lib/battle-plan/api.shared";
import {
  reloadSerializedDashboard,
  updateBattlePlanSettings,
} from "@/lib/battle-plan/repository.server";
import {
  handleBattlePlanMutationError,
  requireBattlePlanAllianceContext,
  requireBattlePlanWrite,
} from "@/lib/battle-plan/route-helpers.server";
import { getServerCalendarDate } from "@/lib/trains/game-time";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  const context = await requireBattlePlanAllianceContext();
  if ("error" in context && context.error) {
    return context.error;
  }

  const { sessionId, allianceId } = context;
  const denied = await requireBattlePlanWrite(sessionId);
  if (denied) return denied;

  const body = await request.json();
  const validationError = validateBattlePlanSettingsPayload(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  try {
    await updateBattlePlanSettings(allianceId, {
      planRevision: body.planRevision,
      ...(body.defaultCapturePolicy !== undefined
        ? { defaultCapturePolicy: body.defaultCapturePolicy }
        : {}),
      ...(body.discordReportsEnabled !== undefined
        ? { discordReportsEnabled: body.discordReportsEnabled }
        : {}),
    });
    const dashboard = await reloadSerializedDashboard(
      allianceId,
      true,
      getServerCalendarDate(),
    );
    return NextResponse.json({ dashboard });
  } catch (error) {
    return handleBattlePlanMutationError(error, allianceId, sessionId);
  }
}
