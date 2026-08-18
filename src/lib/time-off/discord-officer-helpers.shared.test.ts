import { describe, expect, it } from "vitest";

import {
  matchLinkedCommanderByName,
  parseWhoIsAwayWhen,
  resolveWhoIsAwayRange,
} from "@/lib/time-off/discord-officer-helpers.shared";

describe("parseWhoIsAwayWhen", () => {
  it("defaults to today", () => {
    expect(parseWhoIsAwayWhen(undefined)).toBe("today");
    expect(parseWhoIsAwayWhen("")).toBe("today");
    expect(parseWhoIsAwayWhen("bogus")).toBe("today");
  });

  it("accepts week case-insensitively", () => {
    expect(parseWhoIsAwayWhen("week")).toBe("week");
    expect(parseWhoIsAwayWhen("WEEK")).toBe("week");
    expect(parseWhoIsAwayWhen(" Week ")).toBe("week");
  });
});

describe("resolveWhoIsAwayRange", () => {
  it("returns a single-day range for today", () => {
    expect(resolveWhoIsAwayRange("2026-07-27", "today")).toEqual({
      rangeStart: "2026-07-27",
      rangeEnd: "2026-07-27",
    });
  });

  it("returns the Mon–Sun server week for week", () => {
    // 2026-07-29 (Wed) falls in the Mon 2026-07-27 – Sun 2026-08-02 week.
    expect(resolveWhoIsAwayRange("2026-07-29", "week")).toEqual({
      rangeStart: "2026-07-27",
      rangeEnd: "2026-08-02",
    });
  });
});

describe("matchLinkedCommanderByName", () => {
  const links = [
    { memberDisplayName: "Mew2407" },
    { memberDisplayName: "Sunny Day" },
  ];

  it("matches a single link case-insensitively", () => {
    expect(matchLinkedCommanderByName(links, "sunny day")).toBe(links[1]);
    expect(matchLinkedCommanderByName(links, "MEW2407")).toBe(links[0]);
  });

  it("returns null when no name is given", () => {
    expect(matchLinkedCommanderByName(links, undefined)).toBeNull();
    expect(matchLinkedCommanderByName(links, "  ")).toBeNull();
  });

  it("returns null when there is no match", () => {
    expect(matchLinkedCommanderByName(links, "Nobody")).toBeNull();
  });
});
