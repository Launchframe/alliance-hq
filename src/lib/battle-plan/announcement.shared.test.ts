import { describe, expect, it } from "vitest";

import {
  generateBattlePlanAnnouncement,
  listCaptureEventsInNextHours,
  type BattlePlanAnnouncementStrings,
} from "@/lib/battle-plan/announcement.shared";
import type { SerializedCaptureEvent } from "@/lib/battle-plan/types.shared";

const strings: BattlePlanAnnouncementStrings = {
  stronghold: "Stronghold",
  city: "City",
  serverTimeSuffix: "ST",
  summary: (cityCount, strongholdCount) => {
    const cityLabel = cityCount === 1 ? "city" : "cities";
    const strongholdLabel = strongholdCount === 1 ? "stronghold" : "strongholds";
    return `Next 24 hours: ${cityCount} ${cityLabel} and ${strongholdCount} ${strongholdLabel} to take.`;
  },
  policyWar: "Expect these to be contested.",
  policyPeace: "In-and-out with these Strongholds.",
  seasonDisclaimer: "DO NOT LOOT GOLD",
  empty: "No captures scheduled.",
  markerLabel: (preset) => {
    if (preset === "ordinal-1") return "1st marker";
    if (preset === "ordinal-2") return "2nd marker";
    if (preset === "hammer") return "Build here marker";
    return preset;
  },
  dropLine: ({ markerLabel, dropServerTime }) =>
    `We are dropping the Bank with marker ${markerLabel} at ${dropServerTime} ST. Please limit deposit terms on any new deposits with this bank.`,
};

const baseEvent = (
  overrides: Partial<SerializedCaptureEvent>,
): SerializedCaptureEvent => ({
  id: "evt-1",
  eventType: "capture",
  scheduledAt: "2026-07-15T22:00:00.000-02:00",
  serverCalendarDate: "2026-07-15",
  territoryType: "stronghold",
  iconPreset: "ordinal-1",
  capturePolicy: "peace",
  effectiveCapturePolicy: "peace",
  notes: null,
  status: "scheduled",
  bankId: null,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
  ...overrides,
});

describe("listCaptureEventsInNextHours", () => {
  const now = new Date("2026-07-15T12:00:00.000-02:00");

  it("includes scheduled events within the next 24 hours", () => {
    const events = [
      baseEvent({ id: "a", scheduledAt: "2026-07-15T20:00:00.000-02:00" }),
      baseEvent({
        id: "b",
        scheduledAt: "2026-07-16T11:00:00.000-02:00",
        territoryType: "city",
        iconPreset: "hammer",
      }),
      baseEvent({
        id: "c",
        scheduledAt: "2026-07-16T13:00:00.000-02:00",
      }),
    ];
    expect(listCaptureEventsInNextHours(events, 24, now).map((event) => event.id)).toEqual(
      ["a", "b"],
    );
  });
});

describe("generateBattlePlanAnnouncement", () => {
  const now = new Date("2026-07-15T12:00:00.000-02:00");

  it("formats the next 24 hours with summary, lines, and peace policy", () => {
    const events = [
      baseEvent({
        id: "sh1",
        scheduledAt: "2026-07-15T20:00:00.000-02:00",
        iconPreset: "ordinal-1",
      }),
      baseEvent({
        id: "sh2",
        scheduledAt: "2026-07-15T20:15:00.000-02:00",
        iconPreset: "ordinal-2",
      }),
      baseEvent({
        id: "city1",
        scheduledAt: "2026-07-16T11:00:00.000-02:00",
        serverCalendarDate: "2026-07-16",
        territoryType: "city",
        iconPreset: "hammer",
      }),
    ];

    const text = generateBattlePlanAnnouncement(events, {
      seasonKey: "4",
      strings,
      now,
    });

    expect(text).toContain("Next 24 hours: 1 city and 2 strongholds to take.");
    expect(text).toContain("20:00 ST - Stronghold [1st marker]");
    expect(text).toContain("20:15 ST - Stronghold [2nd marker]");
    expect(text).toContain("11:00 ST - City [Build here marker]");
    expect(text).toContain("In-and-out with these Strongholds.");
    expect(text).not.toContain("DO NOT LOOT GOLD");
  });

  it("uses war policy notes and season 5 disclaimer when applicable", () => {
    const events = [
      baseEvent({
        effectiveCapturePolicy: "war",
        capturePolicy: "war",
      }),
    ];

    const text = generateBattlePlanAnnouncement(events, {
      seasonKey: "5",
      strings,
      now,
    });

    expect(text).toContain("Expect these to be contested.");
    expect(text).toContain("DO NOT LOOT GOLD");
  });

  it("returns empty message when nothing is scheduled", () => {
    expect(
      generateBattlePlanAnnouncement([], {
        seasonKey: "1",
        strings,
        now,
      }),
    ).toBe("No captures scheduled.");
  });

  it("formats drop events with the deposit-limit wording", () => {
    const events = [
      baseEvent({
        id: "drop-1",
        eventType: "drop",
        bankId: "bank-1",
        scheduledAt: "2026-07-15T20:00:00.000-02:00",
        iconPreset: "ordinal-1",
      }),
    ];

    const text = generateBattlePlanAnnouncement(events, {
      seasonKey: "5",
      strings,
      now,
    });

    expect(text).toContain(
      "We are dropping the Bank with marker 1st marker at 20:00 ST. Please limit deposit terms on any new deposits with this bank.",
    );
    expect(text).toContain("Next 24 hours: 0 cities and 0 strongholds to take.");
    expect(text).not.toContain("In-and-out with these Strongholds.");
    expect(text).toContain("DO NOT LOOT GOLD");
  });
});
