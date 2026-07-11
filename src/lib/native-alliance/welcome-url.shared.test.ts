import { describe, expect, it } from "vitest";

import {
  buildWelcomeFallbackUrl,
  buildWelcomeInviteUrl,
  buildWelcomeJoinCodeUrl,
  DEFAULT_WELCOME_FALLBACK_PATH,
  resolveWizardWelcomeUrl,
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

  it("returns null when alliance tag is missing", () => {
    expect(buildWelcomeJoinCodeUrl("https://hq.example", null, "LFGO-A1B2C3")).toBe(
      null,
    );
    expect(buildWelcomeJoinCodeUrl("https://hq.example", "  ", "LFGO-A1B2C3")).toBe(
      null,
    );
  });

  it("builds dashboard fallback URL from origin", () => {
    expect(DEFAULT_WELCOME_FALLBACK_PATH).toBe("/dashboard");
    expect(buildWelcomeFallbackUrl("https://hq.example/")).toBe(
      "https://hq.example/dashboard",
    );
  });

  it("resolveWizardWelcomeUrl keeps tag-required state without a junk URL", () => {
    expect(
      resolveWizardWelcomeUrl({
        origin: "https://hq.example",
        welcomeUrl: null,
        welcomeUrlRequiresAllianceTag: true,
      }),
    ).toEqual({
      welcomeUrl: "",
      welcomeUrlRequiresAllianceTag: true,
    });
  });

  it("resolveWizardWelcomeUrl falls back to dashboard when welcome URL is absent", () => {
    expect(
      resolveWizardWelcomeUrl({
        origin: "https://hq.example",
        welcomeUrl: null,
      }),
    ).toEqual({
      welcomeUrl: "https://hq.example/dashboard",
      welcomeUrlRequiresAllianceTag: false,
    });
  });
});
