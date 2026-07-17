import { describe, expect, it } from "vitest";

import { findAdminVideoJobNeighborIds } from "./admin-video-job-neighbors.shared";

describe("findAdminVideoJobNeighborIds", () => {
  it("returns previous and next around a middle job", () => {
    expect(findAdminVideoJobNeighborIds(["a", "b", "c"], "b")).toEqual({
      previousId: "a",
      nextId: "c",
    });
  });

  it("returns null previous at the start of the list", () => {
    expect(findAdminVideoJobNeighborIds(["a", "b", "c"], "a")).toEqual({
      previousId: null,
      nextId: "b",
    });
  });

  it("returns null next at the end of the list", () => {
    expect(findAdminVideoJobNeighborIds(["a", "b", "c"], "c")).toEqual({
      previousId: "b",
      nextId: null,
    });
  });

  it("returns nulls when the current job is not in the filtered window", () => {
    expect(findAdminVideoJobNeighborIds(["a", "b"], "z")).toEqual({
      previousId: null,
      nextId: null,
    });
  });
});
