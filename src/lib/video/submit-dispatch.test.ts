import { beforeEach, describe, expect, it, vi } from "vitest";

const base44CallFunction = vi.hoisted(() => vi.fn());
const base44BulkInsert = vi.hoisted(() => vi.fn());
const base44EntityPost = vi.hoisted(() => vi.fn());

vi.mock("@/lib/base44/fetch", () => ({
  base44CallFunction,
  base44BulkInsert,
  base44EntityPost,
}));

import { dispatchScoreSubmit } from "@/lib/video/submit-dispatch";
import { getScoreTargetOrThrow } from "@/lib/video/score-targets";

describe("dispatchScoreSubmit vs-performance", () => {
  beforeEach(() => {
    base44CallFunction.mockReset();
    base44BulkInsert.mockReset();
    base44EntityPost.mockReset();
    base44CallFunction.mockResolvedValue({ success: true });
  });

  it("calls bulkUpsertVSScores with is_weekly for weekly period", async () => {
    const target = getScoreTargetOrThrow("vs-performance");
    await dispatchScoreSubmit(
      {} as never,
      target,
      [
        {
          alliance_id: "a1",
          member_id: "m1",
          member_name: "Alice",
          competition_id: "2026-07-12",
          score: 100,
          recorded_date: "2026-07-12",
        },
      ],
      {
        submitContext: {
          recordedDate: "2026-07-12",
          vsPeriod: "weekly",
        },
        allianceSizeAtRecord: 95,
      },
    );

    expect(base44CallFunction).toHaveBeenCalledWith(
      {},
      "bulkUpsertVSScores",
      expect.objectContaining({
        alliance_id: "a1",
        competition_id: "2026-07-12",
        recorded_date: "2026-07-12",
        alliance_size_at_record: 95,
        is_weekly: true,
        unmatched: [],
        scores: [
          expect.objectContaining({
            member_id: "m1",
            member_name: "Alice",
            score: 100,
          }),
        ],
      }),
    );
    expect(base44BulkInsert).not.toHaveBeenCalled();
  });

  it("calls bulkUpsertVSScores with is_weekly false for daily", async () => {
    const target = getScoreTargetOrThrow("vs-performance");
    await dispatchScoreSubmit(
      {} as never,
      target,
      [
        {
          alliance_id: "a1",
          member_id: "m1",
          member_name: "Alice",
          competition_id: "2026-07-11",
          score: 50,
          recorded_date: "2026-07-11",
        },
      ],
      {
        submitContext: {
          recordedDate: "2026-07-11",
          vsPeriod: "daily",
        },
      },
    );

    expect(base44CallFunction).toHaveBeenCalledWith(
      {},
      "bulkUpsertVSScores",
      expect.objectContaining({
        is_weekly: false,
        competition_id: "2026-07-11",
      }),
    );
  });
});
