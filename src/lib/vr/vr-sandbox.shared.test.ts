import { describe, expect, it } from "vitest";

import {
  buildSandboxSeasonKey,
  isSandboxSeasonKey,
  VR_SANDBOX_SEASON_KEY_PREFIX,
} from "./vr-sandbox.shared";

describe("vr-sandbox.shared", () => {
  it("identifies sandbox season keys", () => {
    expect(isSandboxSeasonKey(`${VR_SANDBOX_SEASON_KEY_PREFIX}abc`)).toBe(true);
    expect(isSandboxSeasonKey("4")).toBe(false);
  });

  it("builds prefixed sandbox keys", () => {
    expect(buildSandboxSeasonKey("test123")).toBe("sandbox:test123");
  });
});
