import { describe, expect, it } from "vitest";

import { parseBytesRangeHeader } from "./http-byte-range";

describe("parseBytesRangeHeader", () => {
  it("returns null when Range header is absent", () => {
    expect(parseBytesRangeHeader(null, 1000)).toBeNull();
  });

  it("parses closed byte ranges", () => {
    expect(parseBytesRangeHeader("bytes=0-499", 1000)).toEqual({
      start: 0,
      end: 499,
    });
  });

  it("parses open-ended ranges", () => {
    expect(parseBytesRangeHeader("bytes=500-", 1000)).toEqual({
      start: 500,
      end: 999,
    });
  });

  it("parses suffix ranges", () => {
    expect(parseBytesRangeHeader("bytes=-200", 1000)).toEqual({
      start: 800,
      end: 999,
    });
  });

  it("rejects unsatisfiable ranges", () => {
    expect(parseBytesRangeHeader("bytes=2000-3000", 1000)).toBe("unsatisfiable");
  });
});
