import { describe, expect, it } from "vitest";

import { NATIVE_ROSTER_TESSERACT_CONCURRENCY } from "@/lib/video/ocr-roster-native";

describe("NATIVE_ROSTER_TESSERACT_CONCURRENCY", () => {
  it("serializes frames because tesseract.js uses one worker per process", () => {
    expect(NATIVE_ROSTER_TESSERACT_CONCURRENCY).toBe(1);
  });
});
