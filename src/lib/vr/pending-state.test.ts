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
});
