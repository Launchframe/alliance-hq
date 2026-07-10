import { NextResponse } from "next/server";

import {
  reloadSerializedDashboard,
  updateBattlePlanMarker,
} from "@/lib/battle-plan/repository.server";
import {
  handleBattlePlanMutationError,
  requireBattlePlanAllianceContext,
  requireBattlePlanWrite,
} from "@/lib/battle-plan/route-helpers.server";
import {
  isMarkerNumber,
  validateBattlePlanMarkerPayload,
} from "@/lib/battle-plan/api.shared";
import { getServerCalendarDate } from "@/lib/trains/game-time";

type Props = { params: Promise<{ markerNumber: string }> };

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: Props) {
  const context = await requireBattlePlanAllianceContext();
  if ("error" in context && context.error) {
    return context.error;
  }

  const { sessionId, allianceId } = context;
  const denied = await requireBattlePlanWrite(sessionId);
  if (denied) return denied;

  const { markerNumber: markerNumberRaw } = await params;
  const markerNumber = Number(markerNumberRaw);
  if (!isMarkerNumber(markerNumber)) {
    return NextResponse.json(
      { error: "markerNumber must be between 1 and 5." },
      { status: 400 },
    );
  }

  const body = (await request.json()) as {
    iconPreset: string;
    planRevision: number;
  };
  const validationError = validateBattlePlanMarkerPayload(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }
  if (typeof body.planRevision !== "number") {
    return NextResponse.json({ error: "planRevision is required." }, { status: 400 });
  }

  try {
    await updateBattlePlanMarker(allianceId, markerNumber, body);
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
