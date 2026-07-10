import { describe, expect, it } from "vitest";

import {
  anomalyConfirmMessage,
  peerMaxExcludingCommander,
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

  it("finds peer max excluding commander", () => {
    expect(
      peerMaxExcludingCommander(
        [
          { commanderId: "a", highestBaseVr: 5000 },
          { commanderId: "b", highestBaseVr: 7250 },
          { commanderId: "c", highestBaseVr: 7000 },
        ],
        "b",
      ),
    ).toBe(7000);
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

  it("uses playful copy", () => {
    expect(anomalyConfirmMessage(8000)).toMatch(/sure/i);
  });
});
