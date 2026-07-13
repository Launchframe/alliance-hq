import { describe, expect, it } from "vitest";

import {
  ashedEventCalendarDate,
  buildAshedEventLookupQuery,
  buildAshedEventProvisionBody,
  pickAshedEventMatchingDate,
  usesEventDateField,
} from "@/lib/video/ashed-event-provision";
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

describe("ashed event date matching", () => {
  it("builds lookup queries by entity date field", () => {
    expect(
      buildAshedEventLookupQuery("DesertStormEvent", "a1", "2026-07-10"),
    ).toEqual({ alliance_id: "a1", event_date: "2026-07-10" });
    expect(
      buildAshedEventLookupQuery("AllianceExercise", "a1", "2026-07-10"),
    ).toEqual({ alliance_id: "a1", start_date: "2026-07-10" });
    expect(usesEventDateField("DesertStormEvent")).toBe(true);
    expect(usesEventDateField("AllianceExercise")).toBe(false);
  });

  it("picks the event whose calendar date matches recordedDate", () => {
    expect(
      pickAshedEventMatchingDate(
        [
          { id: "old", event_date: "2026-07-09" },
          { id: "hit", event_date: "2026-07-10T00:00:00.000Z" },
        ],
        "2026-07-10",
      )?.id,
    ).toBe("hit");
    expect(ashedEventCalendarDate({ start_date: "2026-07-10" })).toBe(
      "2026-07-10",
    );
  });
});
