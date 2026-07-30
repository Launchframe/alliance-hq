import { describe, expect, it } from "vitest";

import {
  computeDepositTermRiskGauges,
  shouldShowRiskReconfirmHint,
} from "@/lib/banks/risk-profile.shared";

const NOW = new Date("2026-07-27T12:00:00.000-02:00");
const PROTECTION = new Date("2026-07-29T12:00:00.000-02:00"); // Wed +2d

describe("risk-profile.shared", () => {
  it("returns unknown when protection is missing", () => {
    const gauges = computeDepositTermRiskGauges({
      now: NOW,
      protectionExpiresAt: null,
      dropByAt: null,
      counterpartyRiskScore: null,
    });
    expect(gauges.every((g) => g.band === "unknown")).toBe(true);
  });

  it("marks short terms risk-free before protection ends", () => {
    const gauges = computeDepositTermRiskGauges({
      now: NOW,
      protectionExpiresAt: PROTECTION,
      dropByAt: null,
      counterpartyRiskScore: 80,
    });
    expect(gauges[0]?.band).toBe("risk-free"); // 1d
    expect(gauges[1]?.band).not.toBe("risk-free"); // 3d matures after protection
  });

  it("marks 5d as chasing alpha when protection ends sooner", () => {
    const gauges = computeDepositTermRiskGauges({
      now: NOW,
      protectionExpiresAt: PROTECTION,
      dropByAt: null,
      counterpartyRiskScore: 20,
    });
    const fiveDay = gauges.find((g) => g.termDays === 5);
    expect(fiveDay?.band).toBe("low");
    expect(fiveDay?.fillPercent).toBeGreaterThan(25);
  });

  it("marks imminent when drop precedes maturity", () => {
    const gauges = computeDepositTermRiskGauges({
      now: NOW,
      protectionExpiresAt: PROTECTION,
      dropByAt: new Date("2026-07-28T06:00:00.000-02:00"),
      counterpartyRiskScore: 10,
    });
    expect(gauges.every((g) => g.band === "imminent")).toBe(true);
  });
});

describe("shouldShowRiskReconfirmHint", () => {
  const capturedAt = new Date("2026-07-27T10:00:00.000-02:00");
  const protectionExpiresAt = new Date("2026-07-29T12:00:00.000-02:00");

  it("returns false when protection or capture is missing", () => {
    expect(
      shouldShowRiskReconfirmHint({
        protectionExpiresAt: null,
        capturedAt,
        counterpartyRiskUpdatedAt: null,
      }),
    ).toBe(false);
    expect(
      shouldShowRiskReconfirmHint({
        protectionExpiresAt,
        capturedAt: null,
        counterpartyRiskUpdatedAt: null,
      }),
    ).toBe(false);
  });

  it("returns false when protection already expired", () => {
    expect(
      shouldShowRiskReconfirmHint({
        protectionExpiresAt: new Date("2026-07-26T12:00:00.000-02:00"),
        capturedAt,
        counterpartyRiskUpdatedAt: null,
        now: NOW,
      }),
    ).toBe(false);
  });

  it("returns true when risk was never assessed", () => {
    expect(
      shouldShowRiskReconfirmHint({
        protectionExpiresAt,
        capturedAt,
        counterpartyRiskUpdatedAt: null,
        now: NOW,
      }),
    ).toBe(true);
  });

  it("returns true when risk predates capture", () => {
    expect(
      shouldShowRiskReconfirmHint({
        protectionExpiresAt,
        capturedAt,
        counterpartyRiskUpdatedAt: new Date("2026-07-26T12:00:00.000-02:00"),
        now: NOW,
      }),
    ).toBe(true);
  });

  it("returns false when risk was updated after capture", () => {
    expect(
      shouldShowRiskReconfirmHint({
        protectionExpiresAt,
        capturedAt,
        counterpartyRiskUpdatedAt: new Date("2026-07-27T11:00:00.000-02:00"),
        now: NOW,
      }),
    ).toBe(false);
  });
});
