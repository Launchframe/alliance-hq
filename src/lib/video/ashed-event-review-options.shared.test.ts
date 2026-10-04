import { describe, expect, it } from "vitest";

import {
  ASHED_EVENT_AUTO_CREATE_ID,
  buildReviewAshedEventOptions,
  isAshedEventAutoCreateId,
  sortAshedEventsNewestFirst,
} from "@/lib/video/ashed-event-review-options.shared";

const lastWeek = {
  id: "ev-aug7",
  event_date: "2026-08-07",
};
const older = {
  id: "ev-jul31",
  event_date: "2026-07-31",
};

describe("sortAshedEventsNewestFirst", () => {
  it("orders by event calendar date descending", () => {
    expect(
      sortAshedEventsNewestFirst([older, lastWeek]).map((row) => row.id),
    ).toEqual(["ev-aug7", "ev-jul31"]);
  });
});

describe("buildReviewAshedEventOptions", () => {
  it("offers today's recorded date when Ashed only has last week's event", () => {
    const result = buildReviewAshedEventOptions({
      events: [lastWeek, older],
      recordedDate: "2026-08-14",
      eventTypeLabel: "Desert Storm",
      locale: "en-US",
    });

    expect(result.willAutoCreate).toBe(true);
    expect(result.selectedEventId).toBe(ASHED_EVENT_AUTO_CREATE_ID);
    expect(result.options.map((row) => row.id)).toEqual([
      ASHED_EVENT_AUTO_CREATE_ID,
      "ev-aug7",
      "ev-jul31",
    ]);
    expect(result.options[0]?.label).toBe("Desert Storm 08/14/26");
    expect(result.options[0]?.eventDate).toBe("2026-08-14");
  });

  it("selects the matching existing event and does not add auto-create", () => {
    const result = buildReviewAshedEventOptions({
      events: [lastWeek, older],
      recordedDate: "2026-08-07",
      eventTypeLabel: "Desert Storm",
      locale: "en-US",
    });

    expect(result.willAutoCreate).toBe(false);
    expect(result.selectedEventId).toBe("ev-aug7");
    expect(result.options.map((row) => row.id)).toEqual([
      "ev-aug7",
      "ev-jul31",
    ]);
  });
});

describe("isAshedEventAutoCreateId", () => {
  it("treats empty and sentinel ids as auto-create", () => {
    expect(isAshedEventAutoCreateId("")).toBe(true);
    expect(isAshedEventAutoCreateId(ASHED_EVENT_AUTO_CREATE_ID)).toBe(true);
    expect(isAshedEventAutoCreateId("ev-aug7")).toBe(false);
  });
});
