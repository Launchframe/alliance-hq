import { describe, expect, it } from "vitest";

import {
  getNestedMessageValue,
  setNestedMessageValue,
} from "@/lib/i18n/messages-patch";

describe("messages-patch", () => {
  describe("setNestedMessageValue", () => {
    it("updates a nested string leaf without changing siblings", () => {
      const root: Record<string, unknown> = {
        feedback: {
          fab: { reportBug: "Old label", leaveFeedback: "Keep me" },
        },
      };

      setNestedMessageValue(root, "feedback.fab.reportBug", "New label");

      expect(getNestedMessageValue(root, "feedback.fab.reportBug")).toBe(
        "New label",
      );
      expect(getNestedMessageValue(root, "feedback.fab.leaveFeedback")).toBe(
        "Keep me",
      );
    });

    it("throws when the i18n key path does not exist", () => {
      const root: Record<string, unknown> = {
        feedback: { fab: { reportBug: "Old" } },
      };

      expect(() =>
        setNestedMessageValue(root, "feedback.fab.missing", "Nope"),
      ).toThrow(/does not exist/i);
    });

    it("throws when the target is not a string leaf", () => {
      const root: Record<string, unknown> = {
        feedback: { fab: { nested: { deep: "x" } } },
      };

      expect(() =>
        setNestedMessageValue(root, "feedback.fab", "Nope"),
      ).toThrow(/string leaf/i);
    });
  });
});
