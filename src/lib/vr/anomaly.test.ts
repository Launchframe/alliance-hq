import { describe, expect, it } from "vitest";

import {
  anomalyConfirmMessage,
  peerMaxExcludingMember,
  shouldAnomalyConfirm,
} from "@/lib/vr/anomaly";

describe("anomaly detection", () => {
  const rows = [
    { ashedMemberId: "a", highestBaseVr: 5000 },
    { ashedMemberId: "b", highestBaseVr: 7250 },
    { ashedMemberId: "c", highestBaseVr: 7000 },
  ];

  it("finds peer max excluding member", () => {
    expect(peerMaxExcludingMember(rows, "b")).toBe(7000);
  });

  it("requires confirmation when 750+ above peers with enough reporters", () => {
    expect(
      shouldAnomalyConfirm({
        proposedVr: 8000,
        reporterCount: 10,
        peerMax: 7250,
      }),
    ).toBe(true);
  });

  it("skips confirmation below population threshold", () => {
    expect(
      shouldAnomalyConfirm({
        proposedVr: 8000,
        reporterCount: 9,
        peerMax: 7250,
      }),
    ).toBe(false);
  });

  it("does not confirm solely because VR exceeds the legacy 10k cap", () => {
    expect(
      shouldAnomalyConfirm({
        proposedVr: 11200,
        reporterCount: 10,
        peerMax: 10900,
      }),
    ).toBe(false);
    expect(
      shouldAnomalyConfirm({
        proposedVr: 11200,
        reporterCount: 10,
        peerMax: 0,
      }),
    ).toBe(false);
  });

  it("still confirms large peer gaps on season 5 ladders", () => {
    expect(
      shouldAnomalyConfirm({
        proposedVr: 12000,
        reporterCount: 12,
        peerMax: 10900,
      }),
    ).toBe(true);
  });

  it("uses playful copy", () => {
    expect(anomalyConfirmMessage(8000)).toMatch(/sure/i);
  });
});
