import { describe, expect, it } from "vitest";

import {
  isEmailShaped,
  resolveSurveyPlayerNameFromSources,
} from "./survey-player-name";

describe("isEmailShaped", () => {
  it("detects email addresses", () => {
    expect(isEmailShaped("player@example.com")).toBe(true);
    expect(isEmailShaped("Freddy")).toBe(false);
  });
});

describe("resolveSurveyPlayerNameFromSources", () => {
  it("prefers non-email full_name", () => {
    expect(
      resolveSurveyPlayerNameFromSources("Redd KOTF", "Display"),
    ).toBe("Redd KOTF");
  });

  it("skips email-shaped full_name and uses displayName", () => {
    expect(
      resolveSurveyPlayerNameFromSources("player@example.com", "Redd KOTF"),
    ).toBe("Redd KOTF");
  });

  it("returns null when only email-shaped values exist", () => {
    expect(
      resolveSurveyPlayerNameFromSources("a@b.co", "c@d.co"),
    ).toBeNull();
  });
});
