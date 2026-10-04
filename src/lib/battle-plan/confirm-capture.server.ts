import "server-only";

import { and, eq, ne } from "drizzle-orm";

import {
  validateBankPayload,
  type BankPayload,
} from "@/lib/banks/api.shared";
import { ensureBankAtCoords } from "@/lib/banks/repository.server";
import { getDb, schema } from "@/lib/db";

export type ConfirmCaptureErrorCode =
  | "NOT_FOUND"
  | "NOT_STRONGHOLD"
  | "CANCELLED"
  | "MISSING_COORDS"
  | "INVALID_BANK"
  | "CONFLICT";

export class ConfirmCaptureError extends Error {
  constructor(
    message: string,
    readonly code: ConfirmCaptureErrorCode,
  ) {
    super(message);
    this.name = "ConfirmCaptureError";
  }
}

/**
 * Confirm a stronghold capture and link (or create) the bank at its coords.
 *
 * Locks the event row FOR UPDATE so a concurrent cancel cannot be overwritten,
 * and uses ensureBankAtCoords so a crash between bank insert and event link
 * still retries cleanly (no UNIQUE dead-end).
 */
export async function confirmStrongholdCaptureCreatesBank(input: {
  allianceId: string;
  eventId: string;
}): Promise<(typeof schema.banks.$inferSelect)> {
  const db = getDb();

  return db.transaction(async (tx) => {
    const [event] = await tx
      .select()
      .from(schema.battlePlanCaptureEvents)
      .where(
        and(
          eq(schema.battlePlanCaptureEvents.id, input.eventId),
          eq(schema.battlePlanCaptureEvents.allianceId, input.allianceId),
        ),
      )
      .limit(1)
      .for("update");

    if (!event) {
      throw new ConfirmCaptureError("Event not found.", "NOT_FOUND");
    }

    if (event.territoryType !== "stronghold") {
      throw new ConfirmCaptureError(
        "Only stronghold capture events can confirm a bank.",
        "NOT_STRONGHOLD",
      );
    }

    if (event.status === "cancelled") {
      throw new ConfirmCaptureError("Event was cancelled.", "CANCELLED");
    }

    if (event.bankId) {
      const [existingBank] = await tx
        .select()
        .from(schema.banks)
        .where(
          and(
            eq(schema.banks.id, event.bankId),
            eq(schema.banks.allianceId, input.allianceId),
          ),
        )
        .limit(1);
      if (existingBank) {
        return existingBank;
      }
    }

    if (
      event.gameServerNumber == null ||
      event.coordX == null ||
      event.coordY == null ||
      event.level == null
    ) {
      throw new ConfirmCaptureError(
        "Event is missing coordinate or level data.",
        "MISSING_COORDS",
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
      throw new ConfirmCaptureError(validationError, "INVALID_BANK");
    }

    const bank = await ensureBankAtCoords(input.allianceId, bankPayload, tx);

    const linked = await tx
      .update(schema.battlePlanCaptureEvents)
      .set({
        status: "completed",
        bankId: bank.id,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.battlePlanCaptureEvents.id, input.eventId),
          eq(schema.battlePlanCaptureEvents.allianceId, input.allianceId),
          ne(schema.battlePlanCaptureEvents.status, "cancelled"),
        ),
      )
      .returning({
        id: schema.battlePlanCaptureEvents.id,
        status: schema.battlePlanCaptureEvents.status,
        bankId: schema.battlePlanCaptureEvents.bankId,
      });

    if (linked.length === 0) {
      throw new ConfirmCaptureError("Event was cancelled.", "CANCELLED");
    }

    return bank;
  });
}
