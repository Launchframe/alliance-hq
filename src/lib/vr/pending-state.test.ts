import { describe, expect, it } from "vitest";

import { parseStoredVrPending } from "@/lib/vr/pending-state";

describe("parseStoredVrPending", () => {
  it("parses weekly_pass_pick_character pending", () => {
    expect(
      parseStoredVrPending({
        kind: "weekly_pass_pick_character",
        linkIds: ["link-1", "link-2"],
        active: true,
      }),
    ).toEqual({
      kind: "weekly_pass_pick_character",
      linkIds: ["link-1", "link-2"],
      active: true,
    });
  });

  it("rejects weekly_pass_pick_character without boolean active", () => {
    expect(
      parseStoredVrPending({
        kind: "weekly_pass_pick_character",
        linkIds: ["link-1"],
        active: "true",
      }),
    ).toBeNull();
  });

  it("rejects THP anomaly confirm mistaken for VR", () => {
    expect(
      parseStoredVrPending({
        kind: "anomaly_confirm",
        proposedTotal: 999_999_999,
        proposedBreakdown: null,
        commanderId: "cmd-1",
      }),
    ).toBeNull();
  });

  it("rejects VR anomaly confirm with missing proposedVr", () => {
    expect(
      parseStoredVrPending({
        kind: "anomaly_confirm",
        ashedMemberId: "member-1",
      }),
    ).toBeNull();
  });

  it("parses anomaly confirm with a season binding", () => {
    expect(
      parseStoredVrPending({
        kind: "anomaly_confirm",
        proposedVr: 8000,
        commanderId: "cmd-1",
        ashedMemberId: "member-1",
        seasonKey: "1",
      }),
    ).toEqual({
      kind: "anomaly_confirm",
      proposedVr: 8000,
      commanderId: "cmd-1",
      ashedMemberId: "member-1",
      seasonKey: "1",
    });
  });

  it("accepts legacy anomaly confirm rows without a season binding", () => {
    expect(
      parseStoredVrPending({
        kind: "anomaly_confirm",
        proposedVr: 8000,
        ashedMemberId: "member-1",
      }),
    ).toEqual({
      kind: "anomaly_confirm",
      proposedVr: 8000,
      ashedMemberId: "member-1",
    });
  });

  it("rejects kills anomaly confirm mistaken for VR", () => {
    expect(
      parseStoredVrPending({
        kind: "anomaly_confirm",
        proposedTotal: 150_000,
        commanderId: "cmd-1",
      }),
    ).toBeNull();
  });
});
