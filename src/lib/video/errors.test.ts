import { describe, expect, it } from "vitest";

import { AshedNotConnectedError, isAshedNotConnectedError } from "@/lib/video/errors";

describe("AshedNotConnectedError", () => {
  it("carries a stable discriminant code and name", () => {
    const err = new AshedNotConnectedError();
    expect(err.code).toBe("ashed_not_connected");
    expect(err.name).toBe("AshedNotConnectedError");
    expect(err).toBeInstanceOf(Error);
  });

  it("accepts a custom message", () => {
    const err = new AshedNotConnectedError("custom");
    expect(err.message).toBe("custom");
  });
});

describe("isAshedNotConnectedError", () => {
  it("returns true for the error instance", () => {
    expect(isAshedNotConnectedError(new AshedNotConnectedError())).toBe(true);
  });

  it("returns false for unrelated errors and values", () => {
    expect(isAshedNotConnectedError(new Error("nope"))).toBe(false);
    expect(isAshedNotConnectedError(null)).toBe(false);
    expect(isAshedNotConnectedError("ashed_not_connected")).toBe(false);
  });
});
