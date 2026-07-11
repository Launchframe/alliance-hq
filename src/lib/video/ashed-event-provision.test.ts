import { describe, expect, it } from "vitest";

import { buildAshedEventProvisionBody } from "@/lib/video/ashed-event-provision";
import { SCORE_TARGETS, usesHqEventStore } from "@/lib/video/score-targets";

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

  it("matches Ashed schema for every score target that auto-provisions events", () => {
    const autoProvisionTargets = SCORE_TARGETS.filter(
      (target) => target.eventEntity && !usesHqEventStore(target),
    );
    expect(autoProvisionTargets.map((t) => t.eventEntity)).toEqual([
      "DesertStormEvent",
      "CanyonStormEvent",
      "AllianceExercise",
      "ZombieSiegeEvent",
    ]);

    for (const target of autoProvisionTargets) {
      const body = buildAshedEventProvisionBody(
        target.eventEntity!,
        "alliance-1",
        "2026-06-16",
      );
      if (target.eventEntity === "AllianceExercise") {
        expect(body).toEqual({
          alliance_id: "alliance-1",
          start_date: "2026-06-16",
          end_date: "2026-06-16",
        });
      } else {
        expect(body).toEqual({
          alliance_id: "alliance-1",
          event_date: "2026-06-16",
        });
      }
    }
  });
});
