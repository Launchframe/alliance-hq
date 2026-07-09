import { NextResponse } from "next/server";

import {
  serializeCaptureEvent,
  validateCaptureEventPayload,
  type CaptureEventPayload,
} from "@/lib/battle-plan/api.shared";
import {
  createCaptureEvent,
  reloadSerializedDashboard,
} from "@/lib/battle-plan/repository.server";
import {
  handleBattlePlanMutationError,
  requireBattlePlanAllianceContext,
  requireBattlePlanWrite,
} from "@/lib/battle-plan/route-helpers.server";
import { getServerCalendarDate } from "@/lib/trains/game-time";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const context = await requireBattlePlanAllianceContext();
  if ("error" in context && context.error) {
    return context.error;
  }

  const { sessionId, session, allianceId } = context;
  const denied = await requireBattlePlanWrite(sessionId);
  if (denied) return denied;

  const body = (await request.json()) as CaptureEventPayload & {
    planRevision: number;
  };
  const validationError = validateCaptureEventPayload(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }
  if (typeof body.planRevision !== "number") {
    return NextResponse.json({ error: "planRevision is required." }, { status: 400 });
  }

  try {
    const row = await createCaptureEvent(
      allianceId,
      session.hqUserId ?? null,
      body,
    );
    const dashboard = await reloadSerializedDashboard(
      allianceId,
      true,
      getServerCalendarDate(),
    );
    return NextResponse.json({
      event: serializeCaptureEvent(
        row,
        dashboard.settings.defaultCapturePolicy,
      ),
      dashboard,
    });
  } catch (error) {
    return handleBattlePlanMutationError(error, allianceId, sessionId);
  }
}
