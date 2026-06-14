import { describe, expect, it } from "vitest";

import {
  mergeServerTranslationKeyResolution,
  normalizeTranslationText,
  resolveTranslationKeysFromClient,
  stripIcuPlaceholders,
  translationTemplateMatchesDisplay,
} from "@/lib/feedback/translation-key-resolve";

describe("translation-key-resolve", () => {
  it("finds a unique key from nested messages", () => {
    const messages = {
      feedback: {
        fab: {
          reportBug: "Report a bug",
        },
      },
    };
    const result = resolveTranslationKeysFromClient(messages, "Report a bug");
    expect(result.i18nKey).toBe("feedback.fab.reportBug");
    expect(result.candidateKeys).toEqual(["feedback.fab.reportBug"]);
  });

  it("returns null key when ambiguous", () => {
    const messages = {
      a: { label: "Save" },
      b: { label: "Save" },
    };
    const result = resolveTranslationKeysFromClient(messages, "Save");
    expect(result.i18nKey).toBeNull();
    expect(result.candidateKeys).toHaveLength(2);
  });

  it("normalizes whitespace in selections and templates", () => {
    expect(
      translationTemplateMatchesDisplay("Save  {count}  scores", "Save 5 scores"),
    ).toBe(true);
    expect(normalizeTranslationText("  hello \n world ")).toBe("hello world");
  });

  it("matches interpolated ICU simple placeholders", () => {
    expect(
      translationTemplateMatchesDisplay("Connected as {user}", "Connected as alice"),
    ).toBe(true);
    expect(
      resolveTranslationKeysFromClient(
        { settings: { connectedAs: "Connected as {user}" } },
        "Connected as alice",
      ).i18nKey,
    ).toBe("settings.connectedAs");
  });

  it("matches partial selections of literal segments", () => {
    expect(
      translationTemplateMatchesDisplay("Connected as {user}", "Connected as"),
    ).toBe(true);
    expect(
      resolveTranslationKeysFromClient(
        { videoReview: { saveScores: "Save {count} scores" } },
        "Save",
      ).candidateKeys,
    ).toContain("videoReview.saveScores");
  });

  it("matches plural ICU templates against rendered text", () => {
    const template = "{days, plural, one {# day} other {# days}} before expiration";
    expect(stripIcuPlaceholders(template)).toBe("before expiration");
    expect(
      translationTemplateMatchesDisplay(template, "3 days before expiration"),
    ).toBe(true);
  });

  it("does not match unrelated strings", () => {
    expect(
      translationTemplateMatchesDisplay("Save {count} scores", "Delete member"),
    ).toBe(false);
  });

  it("mergeServerTranslationKeyResolution prefers server unique key", () => {
    expect(
      mergeServerTranslationKeyResolution(
        { i18nKey: "a.key", candidateKeys: ["a.key"] },
        "spoof.key",
      ),
    ).toEqual({ i18nKey: "a.key", candidateKeys: ["a.key"] });
  });

  it("mergeServerTranslationKeyResolution rejects spoofed client-only keys", () => {
    expect(
      mergeServerTranslationKeyResolution(
        { i18nKey: null, candidateKeys: ["real.key", "other.key"] },
        "spoof.key",
      ),
    ).toEqual({ i18nKey: null, candidateKeys: ["real.key", "other.key"] });
  });

  it("mergeServerTranslationKeyResolution accepts client key when server agrees uniquely", () => {
    expect(
      mergeServerTranslationKeyResolution(
        { i18nKey: null, candidateKeys: ["feedback.fab.reportBug"] },
        "feedback.fab.reportBug",
      ),
    ).toEqual({
      i18nKey: "feedback.fab.reportBug",
      candidateKeys: ["feedback.fab.reportBug"],
    });
  });
});
