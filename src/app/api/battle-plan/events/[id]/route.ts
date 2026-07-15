import { NextResponse } from "next/server";

import {
  serializeCaptureEvent,
  validateCaptureEventPayload,
  type CaptureEventPayload,
} from "@/lib/battle-plan/api.shared";
import {
  deactivateCaptureReminderInboxItem,
  materializeCaptureReminderInboxItem,
} from "@/lib/battle-plan/capture-reminder-inbox.server";
import {
  deleteCaptureEvent,
  reloadSerializedDashboard,
  updateCaptureEvent,
} from "@/lib/battle-plan/repository.server";
import {
  handleBattlePlanMutationError,
  requireBattlePlanAllianceContext,
  requireBattlePlanWrite,
} from "@/lib/battle-plan/route-helpers.server";
import { getServerCalendarDate } from "@/lib/trains/game-time";

type Props = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

export async function PUT(request: Request, { params }: Props) {
  const context = await requireBattlePlanAllianceContext();
  if ("error" in context && context.error) {
    return context.error;
  }

  const { sessionId, allianceId } = context;
  const denied = await requireBattlePlanWrite(sessionId);
  if (denied) return denied;

  const { id } = await params;
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
    const row = await updateCaptureEvent(allianceId, id, body);

    const isStrongholdCapture =
      row.territoryType === "stronghold" &&
      (row.eventType ?? "capture") === "capture";
    const isScheduled = (row.status ?? "scheduled") === "scheduled";

    if (isStrongholdCapture && isScheduled) {
      const title = row.notes?.trim()
        ? `Stronghold capture: ${row.notes.trim()}`
        : "Stronghold capture";
      await materializeCaptureReminderInboxItem({
        allianceId,
        captureEventId: row.id,
        scheduledAt: row.scheduledAt,
        title,
      });
    } else {
      await deactivateCaptureReminderInboxItem(row.id);
    }

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

export async function DELETE(request: Request, { params }: Props) {
  const context = await requireBattlePlanAllianceContext();
  if ("error" in context && context.error) {
    return context.error;
  }

  const { sessionId, allianceId } = context;
  const denied = await requireBattlePlanWrite(sessionId);
  if (denied) return denied;

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    planRevision?: number;
  };
  if (typeof body.planRevision !== "number") {
    return NextResponse.json({ error: "planRevision is required." }, { status: 400 });
  }

  try {
    await deleteCaptureEvent(allianceId, id, body.planRevision);
    await deactivateCaptureReminderInboxItem(id);
    const dashboard = await reloadSerializedDashboard(
      allianceId,
      true,
      getServerCalendarDate(),
    );
    return NextResponse.json({ ok: true, dashboard });
  } catch (error) {
    return handleBattlePlanMutationError(error, allianceId, sessionId);
  }
}
