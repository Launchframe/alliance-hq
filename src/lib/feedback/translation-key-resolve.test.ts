import { describe, expect, it } from "vitest";

import { resolveTranslationKeysFromClient } from "@/lib/feedback/translation-key-resolve";

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
});
