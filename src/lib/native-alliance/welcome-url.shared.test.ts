import { describe, expect, it } from "vitest";

import {
  buildWelcomeInviteUrl,
  buildWelcomeJoinCodeUrl,
  normalizeAllianceTagForUrl,
} from "@/lib/native-alliance/welcome-url.shared";

describe("welcome-url.shared", () => {
  it("builds join code welcome URL with tag and code", () => {
    expect(
      buildWelcomeJoinCodeUrl("https://hq.example", "LFgo", "LFGO-A1B2C3"),
    ).toBe("https://hq.example/welcome?tag=LFgo&code=LFGO-A1B2C3");
  });

  it("builds invite welcome URL", () => {
    expect(buildWelcomeInviteUrl("https://hq.example/", "abc123")).toBe(
      "https://hq.example/welcome?invite=abc123",
    );
  });

  it("falls back to HQ when alliance tag is missing", () => {
    expect(normalizeAllianceTagForUrl(null)).toBe("HQ");
    expect(
      buildWelcomeJoinCodeUrl("https://hq.example", null, "LFGO-A1B2C3"),
    ).toBe("https://hq.example/welcome?tag=HQ&code=LFGO-A1B2C3");
  });
});
