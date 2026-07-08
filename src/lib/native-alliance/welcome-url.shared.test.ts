import { describe, expect, it } from "vitest";

import {
  buildWelcomeInviteUrl,
  buildWelcomeJoinCodeUrl,
  extractInviteTokenFromAcceptUrl,
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

  it("extracts token from legacy invite accept URL", () => {
    expect(
      extractInviteTokenFromAcceptUrl(
        "https://hq.example/invite/abcDEF123?next=%2Fmembers",
      ),
    ).toBe("abcDEF123");
  });
});
