import { describe, expect, it } from "vitest";

import { validateCaptureEventPayload } from "@/lib/battle-plan/api.shared";

describe("validateCaptureEventPayload", () => {
  const validBase = {
    scheduledAt: "2026-07-15T14:00:00.000-02:00",
    territoryType: "stronghold" as const,
    capturePolicy: "peace" as const,
  };

  it("requires iconPreset for scheduled captures", () => {
    expect(
      validateCaptureEventPayload({
        ...validBase,
        iconPreset: null,
      }),
    ).toBe("iconPreset is required for scheduled captures.");
  });

  it("allows missing iconPreset for cancelled captures", () => {
    expect(
      validateCaptureEventPayload({
        ...validBase,
        iconPreset: null,
        status: "cancelled",
      }),
    ).toBeNull();
  });

  it("requires bankId for deposit_window events", () => {
    expect(
      validateCaptureEventPayload({
        scheduledAt: validBase.scheduledAt,
        territoryType: "stronghold",
        iconPreset: "hammer",
        eventType: "deposit_window",
        status: "scheduled",
      }),
    ).toBe("bankId is required for deposit_window events.");
  });
});
