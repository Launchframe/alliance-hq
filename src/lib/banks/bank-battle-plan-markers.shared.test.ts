import { describe, expect, it } from "vitest";

import {
  findScheduledBankBattlePlanEvent,
  resolveBankListMarkerPreset,
} from "@/lib/banks/bank-battle-plan-markers.shared";
import type { SerializedCaptureEvent } from "@/lib/battle-plan/types.shared";

function event(
  overrides: Partial<SerializedCaptureEvent> & Pick<SerializedCaptureEvent, "id">,
): SerializedCaptureEvent {
  return {
    eventType: "drop",
    scheduledAt: "2026-07-15T14:00:00.000-02:00",
    serverCalendarDate: "2026-07-15",
    territoryType: "stronghold",
    iconPreset: "hammer",
    capturePolicy: null,
    effectiveCapturePolicy: "peace",
    notes: null,
    status: "scheduled",
    bankId: "bank-1",
    gameServerNumber: 42,
    coordX: 100,
    coordY: 200,
    level: 5,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("bank-battle-plan-markers.shared", () => {
  it("finds scheduled bank events by type", () => {
    const events = [
      event({ id: "drop-1", eventType: "drop", iconPreset: "sun" }),
      event({
        id: "dw-1",
        eventType: "deposit_window",
        iconPreset: "shield",
      }),
    ];
    expect(findScheduledBankBattlePlanEvent(events, "bank-1", "drop")?.id).toBe(
      "drop-1",
    );
    expect(
      findScheduledBankBattlePlanEvent(events, "bank-1", "deposit_window")?.id,
    ).toBe("dw-1");
  });

  it("prefers drop marker over deposit window on list rows", () => {
    const events = [
      event({ id: "drop-1", eventType: "drop", iconPreset: "sun" }),
      event({
        id: "dw-1",
        eventType: "deposit_window",
        iconPreset: "shield",
      }),
    ];
    expect(resolveBankListMarkerPreset(events, "bank-1")).toBe("sun");
  });

  it("falls back to deposit window marker when no drop is scheduled", () => {
    const events = [
      event({
        id: "dw-1",
        eventType: "deposit_window",
        iconPreset: "shield",
      }),
    ];
    expect(resolveBankListMarkerPreset(events, "bank-1")).toBe("shield");
  });
});
