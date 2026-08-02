import { describe, expect, it } from "vitest";

import {
  ASHED_SCORE_LIST_LIMIT,
  buildAshedScoreListPath,
} from "./ashed-date-scores.server";

describe("buildAshedScoreListPath", () => {
  it("matches Ashed admin HAR query shape (sort, limit, fields)", () => {
    const path = buildAshedScoreListPath({
      submitEntity: "DesertStormScore",
      ashedAllianceId: "alliance-1",
    });
    expect(path).toContain("/entities/DesertStormScore?");
    expect(path).toContain("sort=-recorded_date");
    expect(path).toContain(`limit=${ASHED_SCORE_LIST_LIMIT}`);
    const fields = new URLSearchParams(path.split("?")[1] ?? "").get("fields");
    expect(fields).toContain("id,member_id,member_name");
    expect(path).toContain(
      encodeURIComponent(JSON.stringify({ alliance_id: "alliance-1" })),
    );
  });

  it("includes event_id in q when provided", () => {
    const path = buildAshedScoreListPath({
      submitEntity: "AllianceExerciseScore",
      ashedAllianceId: "alliance-1",
      eventId: "ev-1",
    });
    expect(path).toContain(
      encodeURIComponent(
        JSON.stringify({ alliance_id: "alliance-1", event_id: "ev-1" }),
      ),
    );
  });
});
