import { NextResponse } from "next/server";

import { serializeBank } from "@/lib/banks/api.shared";
import { requireBankWrite } from "@/lib/banks/route-helpers.server";
import { deactivateCaptureReminderInboxItem } from "@/lib/battle-plan/capture-reminder-inbox.server";
import {
  ConfirmCaptureError,
  confirmStrongholdCaptureCreatesBank,
} from "@/lib/battle-plan/confirm-capture.server";
import {
  requireBattlePlanAllianceContext,
  requireBattlePlanWrite,
} from "@/lib/battle-plan/route-helpers.server";

type Props = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

/**
 * POST /api/battle-plan/events/:id/confirm-capture
 *
 * Called when an officer confirms a stronghold was successfully captured.
 * Creates a bank record from the capture event's coordinate data.
 */
export async function POST(request: Request, { params }: Props) {
  const context = await requireBattlePlanAllianceContext();
  if ("error" in context && context.error) {
    return context.error;
  }

  const { sessionId, allianceId } = context;
  const denied = await requireBattlePlanWrite(sessionId);
  if (denied) return denied;

  const bankDenied = await requireBankWrite(sessionId);
  if (bankDenied) return bankDenied;

  const { id: eventId } = await params;

  try {
    const bank = await confirmStrongholdCaptureCreatesBank({
      allianceId,
      eventId,
    });

    await deactivateCaptureReminderInboxItem(eventId);

    return NextResponse.json({ bank: serializeBank(bank) });
  } catch (error) {
    if (error instanceof ConfirmCaptureError) {
      const status =
        error.code === "NOT_FOUND"
          ? 404
          : error.code === "CANCELLED" || error.code === "CONFLICT"
            ? 409
            : 400;
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status },
      );
    }
    const message =
      error instanceof Error ? error.message : "Unexpected error.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
