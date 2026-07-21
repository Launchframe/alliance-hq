import { describe, expect, it } from "vitest";

import {
  clampMemberHqLevel,
  isValidMemberHqLevel,
  MAX_MEMBER_HQ_LEVEL,
  normalizeMemberHqLevel,
} from "@/lib/members/member-level.shared";

describe("normalizeMemberHqLevel", () => {
  it("accepts levels in range", () => {
    expect(normalizeMemberHqLevel(1)).toBe(1);
    expect(normalizeMemberHqLevel(35)).toBe(35);
    expect(normalizeMemberHqLevel("12")).toBe(12);
  });

  it("clamps above the in-game max", () => {
    expect(normalizeMemberHqLevel(90)).toBe(MAX_MEMBER_HQ_LEVEL);
    expect(normalizeMemberHqLevel(100.7)).toBe(MAX_MEMBER_HQ_LEVEL);
  });

  it("rejects non-positive and junk", () => {
    expect(normalizeMemberHqLevel(0)).toBeNull();
    expect(normalizeMemberHqLevel(-3)).toBeNull();
    expect(normalizeMemberHqLevel("")).toBeNull();
    expect(normalizeMemberHqLevel(null)).toBeNull();
  });
});

describe("clampMemberHqLevel", () => {
  it("bounds values", () => {
    expect(clampMemberHqLevel(0)).toBe(1);
    expect(clampMemberHqLevel(99)).toBe(35);
  });
});

describe("isValidMemberHqLevel", () => {
  it("requires integer in range", () => {
    expect(isValidMemberHqLevel(35)).toBe(true);
    expect(isValidMemberHqLevel(36)).toBe(false);
    expect(isValidMemberHqLevel(12.5)).toBe(false);
  });
});
