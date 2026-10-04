import { describe, expect, it } from "vitest";

import {
  assessPoolGenerationMerge,
  poolGenerationsHaveSelectedOverlap,
} from "@/lib/trains/pool-generation-merge.shared";

describe("poolGenerationsHaveSelectedOverlap", () => {
  it("is false when either side has no selections", () => {
    expect(poolGenerationsHaveSelectedOverlap(["a"], [])).toBe(false);
    expect(poolGenerationsHaveSelectedOverlap([], ["a"])).toBe(false);
  });

  it("detects shared selected member ids", () => {
    expect(poolGenerationsHaveSelectedOverlap(["a", "b"], ["c", "a"])).toBe(
      true,
    );
    expect(poolGenerationsHaveSelectedOverlap(["a", "b"], ["c", "d"])).toBe(
      false,
    );
  });
});

describe("assessPoolGenerationMerge", () => {
  it("allows undo when gen 2 has no picks overlapping gen 1 selections", () => {
    expect(
      assessPoolGenerationMerge({
        currentGeneration: 2,
        priorGeneration: 1,
        priorSelectedMemberIds: ["alice", "bob"],
        currentSelectedMemberIds: [],
      }),
    ).toEqual({
      available: true,
      priorGeneration: 1,
      currentGeneration: 2,
      pendingDraftCount: 0,
      blockReason: null,
    });
  });

  it("allows undo when current drafts are people not selected in prior gen", () => {
    const result = assessPoolGenerationMerge({
      currentGeneration: 2,
      priorGeneration: 1,
      priorSelectedMemberIds: ["alice", "bob"],
      currentSelectedMemberIds: ["carol"],
    });
    expect(result.available).toBe(true);
    expect(result.pendingDraftCount).toBe(1);
  });

  it("blocks when a prior selected member was also picked in current gen", () => {
    expect(
      assessPoolGenerationMerge({
        currentGeneration: 2,
        priorGeneration: 1,
        priorSelectedMemberIds: ["alice", "bob"],
        currentSelectedMemberIds: ["carol", "alice"],
      }).blockReason,
    ).toBe("selected_overlap");
  });

  it("blocks when there is no prior generation", () => {
    expect(
      assessPoolGenerationMerge({
        currentGeneration: 1,
        priorGeneration: null,
        priorSelectedMemberIds: [],
        currentSelectedMemberIds: [],
      }).blockReason,
    ).toBe("no_prior");
  });

  it("blocks when prior is not the immediate previous generation", () => {
    expect(
      assessPoolGenerationMerge({
        currentGeneration: 3,
        priorGeneration: 1,
        priorSelectedMemberIds: ["alice"],
        currentSelectedMemberIds: [],
      }).blockReason,
    ).toBe("not_adjacent");
  });
});
