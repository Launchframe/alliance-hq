import { describe, expect, it } from "vitest";

import {
  anomalyConfirmMessage,
  instituteLevelGap,
  peerMaxExcludingMember,
  peerMaxInstituteLevelExcludingMember,
  shouldAnomalyConfirm,
} from "@/lib/vr/anomaly";

describe("anomaly detection", () => {
  const rows = [
    { ashedMemberId: "a", highestBaseVr: 5000, instituteLevel: 20 },
    { ashedMemberId: "b", highestBaseVr: 7250, instituteLevel: 25 },
    { ashedMemberId: "c", highestBaseVr: 7000, instituteLevel: 24 },
  ];

  it("finds peer max excluding member", () => {
    expect(peerMaxExcludingMember(rows, "b")).toBe(7000);
  });

  it("finds peer max institute level excluding member", () => {
    expect(peerMaxInstituteLevelExcludingMember(rows, "b", "1")).toBe(24);
  });

  it("requires confirmation when 3+ institute levels above peers with enough reporters", () => {
    expect(
      shouldAnomalyConfirm({
        seasonKey: "1",
        proposedVr: 8000,
        reporterCount: 10,
        peerMax: 5000,
      }),
    ).toBe(true);
    expect(
      instituteLevelGap({
        seasonKey: "1",
        proposedVr: 8000,
        peerMaxVr: 5000,
      }),
    ).toBe(6);
  });

  it("skips confirmation below population threshold", () => {
    expect(
      shouldAnomalyConfirm({
        seasonKey: "1",
        proposedVr: 8000,
        reporterCount: 9,
        peerMax: 5000,
      }),
    ).toBe(false);
  });

  it("does not confirm when only one institute level above peers", () => {
    expect(
      shouldAnomalyConfirm({
        seasonKey: "5",
        proposedVr: 11200,
        reporterCount: 10,
        peerMax: 10900,
      }),
    ).toBe(false);
    expect(
      shouldAnomalyConfirm({
        seasonKey: "5",
        proposedVr: 11200,
        reporterCount: 10,
        peerMax: 0,
      }),
    ).toBe(false);
  });

  it("does not confirm for a single large S5 institute level bump above peers", () => {
    expect(
      shouldAnomalyConfirm({
        seasonKey: "5",
        proposedVr: 18000,
        reporterCount: 12,
        peerMax: 13300,
      }),
    ).toBe(false);
    expect(
      instituteLevelGap({
        seasonKey: "5",
        proposedVr: 18000,
        peerMaxVr: 13300,
      }),
    ).toBe(1);
  });

  it("still confirms large institute level gaps on season 5 ladders", () => {
    expect(
      shouldAnomalyConfirm({
        seasonKey: "5",
        proposedVr: 12000,
        reporterCount: 12,
        peerMax: 10900,
      }),
    ).toBe(true);
    expect(
      instituteLevelGap({
        seasonKey: "5",
        proposedVr: 12000,
        peerMaxVr: 10900,
      }),
    ).toBe(5);
  });

  it("uses playful copy", () => {
    expect(anomalyConfirmMessage(8000)).toMatch(/sure/i);
  });
});
