import { describe, expect, it } from "vitest";

import { parseTimeOffMessage } from "@/lib/time-off/parse-natural-language.shared";

const REF = "2026-07-15"; // Wednesday

describe("parseTimeOffMessage", () => {
  it("parses upcoming week phrasing", () => {
    const result = parseTimeOffMessage(
      "I'll be away this upcoming week to visit family in France.",
      REF,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.parsed.startDate).toBe("2026-07-20");
    expect(result.parsed.endDate).toBe("2026-07-26");
    expect(result.parsed.notes.toLowerCase()).toContain("france");
    expect(result.parsed.availability).toBe("full_away");
  });

  it("parses named month ranges", () => {
    const result = parseTimeOffMessage(
      "Traveling to a project site from June 3-11",
      REF,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.parsed.startDate).toBe("2026-06-03");
    expect(result.parsed.endDate).toBe("2026-06-11");
  });

  it("detects limited availability", () => {
    const result = parseTimeOffMessage(
      "Hit and miss this weekend for a music festival",
      REF,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.parsed.availability).toBe("hit_and_miss");
    expect(result.parsed.startDate).toBe("2026-07-18");
    expect(result.parsed.endDate).toBe("2026-07-19");
  });

  it("parses minimums phrasing", () => {
    const result = parseTimeOffMessage(
      "On vacation till this weekend — can maintain minimums",
      REF,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.parsed.availability).toBe("minimums");
  });

  it("parses explicit ISO ranges", () => {
    const result = parseTimeOffMessage(
      "Away 2026-08-01 to 2026-08-14",
      REF,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.parsed.startDate).toBe("2026-08-01");
    expect(result.parsed.endDate).toBe("2026-08-14");
  });

  it("returns unrecognized for vague text", () => {
    const result = parseTimeOffMessage("maybe later", REF);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("unrecognized");
  });
});
