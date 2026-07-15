import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { serializeBank, validateBankPayload, type BankPayload } from "@/lib/banks/api.shared";
import { createBank } from "@/lib/banks/repository.server";
import { requireBankWrite } from "@/lib/banks/route-helpers.server";
import { deactivateCaptureReminderInboxItem } from "@/lib/battle-plan/capture-reminder-inbox.server";
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
  const db = getDb();

  const [event] = await db
    .select()
    .from(schema.battlePlanCaptureEvents)
    .where(
      and(
        eq(schema.battlePlanCaptureEvents.id, eventId),
        eq(schema.battlePlanCaptureEvents.allianceId, allianceId),
      ),
    )
    .limit(1);

  if (!event) {
    return NextResponse.json({ error: "Event not found." }, { status: 404 });
  }

  if (event.territoryType !== "stronghold") {
    return NextResponse.json(
      { error: "Only stronghold capture events can confirm a bank." },
      { status: 400 },
    );
  }

  if (event.status === "cancelled") {
    return NextResponse.json(
      { error: "Event was cancelled." },
      { status: 400 },
    );
  }

  if (event.bankId) {
    const [existingBank] = await db
      .select()
      .from(schema.banks)
      .where(
        and(
          eq(schema.banks.id, event.bankId),
          eq(schema.banks.allianceId, allianceId),
        ),
      )
      .limit(1);
    if (existingBank) {
      await deactivateCaptureReminderInboxItem(eventId);
      return NextResponse.json({ bank: serializeBank(existingBank) });
    }
  }

  if (
    event.gameServerNumber == null ||
    event.coordX == null ||
    event.coordY == null ||
    event.level == null
  ) {
    return NextResponse.json(
      { error: "Event is missing coordinate or level data." },
      { status: 400 },
    );
  }

  const depositPolicy =
    event.capturePolicy === "war" ? "warzone" : "alliance";

  const bankPayload: BankPayload = {
    gameServerNumber: event.gameServerNumber,
    coordX: event.coordX,
    coordY: event.coordY,
    level: event.level,
    capturedAt: event.scheduledAt.toISOString(),
    depositPolicy,
    priorCaptureCount: 1,
  };

  const validationError = validateBankPayload(bankPayload);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  try {
    const bank = await createBank(allianceId, bankPayload);

    await db
      .update(schema.battlePlanCaptureEvents)
      .set({
        status: "completed",
        bankId: bank.id,
        updatedAt: new Date(),
      })
      .where(eq(schema.battlePlanCaptureEvents.id, eventId));

    await deactivateCaptureReminderInboxItem(eventId);

    return NextResponse.json({ bank: serializeBank(bank) });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected error.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
