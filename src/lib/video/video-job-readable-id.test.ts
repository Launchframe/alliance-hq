import { describe, expect, it } from "vitest";

import { newReadableVideoJobId } from "@/lib/video/video-job-readable-id";

describe("newReadableVideoJobId", () => {
  it("returns adjective-noun-hex format", () => {
    const id = newReadableVideoJobId();
    expect(id).toMatch(/^[a-z]+-[a-z]+-[0-9a-f]{8}$/);
  });

  it("generates distinct ids", () => {
    const ids = new Set(Array.from({ length: 20 }, () => newReadableVideoJobId()));
    expect(ids.size).toBe(20);
  });
});
