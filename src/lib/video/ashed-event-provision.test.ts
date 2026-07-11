import { describe, expect, it } from "vitest";

import { buildAshedEventProvisionBody } from "@/lib/video/ashed-event-provision";

describe("buildAshedEventProvisionBody", () => {
  it.each([
    "ZombieSiegeEvent",
    "DesertStormEvent",
    "CanyonStormEvent",
  ] as const)("uses event_date for %s", (eventEntity) => {
    expect(
      buildAshedEventProvisionBody(eventEntity, "alliance-1", "2026-06-16"),
    ).toEqual({
      alliance_id: "alliance-1",
      event_date: "2026-06-16",
    });
  });

  it("uses start/end dates for AllianceExercise", () => {
    expect(
      buildAshedEventProvisionBody(
        "AllianceExercise",
        "alliance-1",
        "2026-06-16",
      ),
    ).toEqual({
      alliance_id: "alliance-1",
      start_date: "2026-06-16",
      end_date: "2026-06-16",
    });
  });
});
