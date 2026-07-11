import { describe, expect, it } from "vitest";

import { getScoreTargetOrThrow } from "@/lib/video/score-targets";
import {
  buildSubmitPayloads,
  validateSubmitContext,
} from "@/lib/video/submit-schemas";

describe("buildSubmitPayloads", () => {
  it("builds desert storm bulk rows", () => {
    const target = getScoreTargetOrThrow("desert-storm");
    const rows = buildSubmitPayloads(
      target,
      "alliance-1",
      { eventId: "ev-1", team: "B", recordedDate: "2026-06-14" },
      [{ memberId: "m1", memberName: "Alice", score: "100" }],
    );
    expect(rows[0]).toMatchObject({
      alliance_id: "alliance-1",
      event_id: "ev-1",
      team: "B",
      score: 100,
    });
  });

  it("builds zombie siege rows with waves_survived", () => {
    const target = getScoreTargetOrThrow("zombie-siege");
    const rows = buildSubmitPayloads(
      target,
      "alliance-1",
      { eventId: "ev-1", recordedDate: "2026-06-16" },
      [{ memberId: "m1", memberName: "Alice", score: "20" }],
    );
    expect(rows[0]).toEqual({
      alliance_id: "alliance-1",
      event_id: "ev-1",
      member_id: "m1",
      member_name: "Alice",
      score: 20,
      waves_survived: 20,
      recorded_date: "2026-06-16",
    });
  });

  it("builds alliance exercise rows with event_id", () => {
    const target = getScoreTargetOrThrow("alliance-exercise");
    const rows = buildSubmitPayloads(
      target,
      "alliance-1",
      { eventId: "exercise-1", recordedDate: "2026-06-16" },
      [{ memberId: "m1", memberName: "Alice", score: "12,345" }],
    );
    expect(rows[0]).toEqual({
      alliance_id: "alliance-1",
      event_id: "exercise-1",
      member_id: "m1",
      member_name: "Alice",
      score: 12345,
      recorded_date: "2026-06-16",
    });
  });

  it("builds seasonal score rows without team", () => {
    const target = getScoreTargetOrThrow("frontline-breakthrough");
    const rows = buildSubmitPayloads(
      target,
      "alliance-1",
      { recordedDate: "2026-06-14" },
      [{ memberId: "m1", memberName: "Bob", score: "1750" }],
      "seasonal-ev-1",
    );
    expect(rows[0]).toEqual({
      alliance_id: "alliance-1",
      event_id: "seasonal-ev-1",
      member_id: "m1",
      member_name: "Bob",
      score: 1750,
      recorded_date: "2026-06-14",
    });
  });

  it("builds VSScore rows with competition_id matching recorded date", () => {
    const target = getScoreTargetOrThrow("vs-performance");
    const rows = buildSubmitPayloads(
      target,
      "alliance-1",
      { recordedDate: "2026-07-10" },
      [{ memberId: "m1", memberName: "Alice", score: "8,956,952", rank: 1 }],
    );
    expect(rows[0]).toEqual({
      alliance_id: "alliance-1",
      member_id: "m1",
      member_name: "Alice",
      competition_id: "2026-07-10",
      score: 8956952,
      rank: 1,
      recorded_date: "2026-07-10",
    });
  });
});

describe("validateSubmitContext", () => {
  it("requires boardKey for seasonal multi-board", () => {
    const target = getScoreTargetOrThrow("seasonal");
    expect(
      validateSubmitContext(
        target,
        { recordedDate: "2026-06-14", hqEventId: "hq-1" },
        5,
      ),
    ).toBe("boardKey is required.");
  });
});
