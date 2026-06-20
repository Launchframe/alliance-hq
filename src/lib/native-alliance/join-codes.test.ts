import { describe, expect, it } from "vitest";

import { normalizeJoinCode } from "./join-codes";

describe("normalizeJoinCode", () => {
  it("uppercases and strips spaces", () => {
    expect(normalizeJoinCode(" lfgo-abc 123 ")).toBe("LFGO-ABC123");
  });
});
