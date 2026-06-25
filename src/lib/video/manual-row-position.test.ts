import { describe, expect, it } from "vitest";

import { frameIndexForManualRow } from "@/lib/video/manual-row-position";

describe("frameIndexForManualRow", () => {
  it("places a row before extracted frames when position is start", () => {
    expect(frameIndexForManualRow([0, 1, 4], "start")).toBe(-1);
  });

  it("places a row after extracted frames when position is end", () => {
    expect(frameIndexForManualRow([0, 1, 4], "end")).toBe(5);
  });

  it("uses -1 and 0 when no frame indexes exist yet", () => {
    expect(frameIndexForManualRow([null, null], "start")).toBe(-1);
    expect(frameIndexForManualRow([null, null], "end")).toBe(0);
  });
});
