import { describe, expect, it } from "vitest";

import { boardIdsForEvidenceRetract } from "./evidence-retract-boards.shared";

describe("boardIdsForEvidenceRetract", () => {
  it("keeps single-board batch.boardId discovery", () => {
    expect(boardIdsForEvidenceRetract(["board-a"], [])).toEqual(["board-a"]);
  });

  it("discovers boards from observations when batch.boardId is null (multi-board commit)", () => {
    // Pre-fix behavior only consulted batch.boardId → empty → no recompute.
    expect(boardIdsForEvidenceRetract([null], [])).toEqual([]);

    expect(
      boardIdsForEvidenceRetract([null], ["board-a", "board-b"]).sort(),
    ).toEqual(["board-a", "board-b"]);
  });

  it("unions batch and observation ids and drops null/empty", () => {
    expect(
      boardIdsForEvidenceRetract(
        ["board-a", null, ""],
        ["board-b", null, "board-a"],
      ).sort(),
    ).toEqual(["board-a", "board-b"]);
  });
});
