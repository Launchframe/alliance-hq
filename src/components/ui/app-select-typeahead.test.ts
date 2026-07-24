import { describe, expect, it } from "vitest";

import {
  appendAppSelectTypeaheadBuffer,
  APP_SELECT_TYPEAHEAD_RESET_MS,
  findEnabledAppSelectTypeaheadIndex,
  isAppSelectTypeaheadKey,
} from "./app-select-typeahead";

describe("isAppSelectTypeaheadKey", () => {
  it("accepts printable characters without modifiers", () => {
    expect(
      isAppSelectTypeaheadKey({
        key: "3",
        ctrlKey: false,
        metaKey: false,
        altKey: false,
      }),
    ).toBe(true);
  });

  it("rejects arrows, enter, and modified keys", () => {
    expect(
      isAppSelectTypeaheadKey({
        key: "ArrowDown",
        ctrlKey: false,
        metaKey: false,
        altKey: false,
      }),
    ).toBe(false);
    expect(
      isAppSelectTypeaheadKey({
        key: "a",
        ctrlKey: true,
        metaKey: false,
        altKey: false,
      }),
    ).toBe(false);
  });
});

describe("appendAppSelectTypeaheadBuffer", () => {
  it("starts a fresh buffer after the reset window", () => {
    expect(
      appendAppSelectTypeaheadBuffer(
        "ab",
        "c",
        APP_SELECT_TYPEAHEAD_RESET_MS + 1,
      ),
    ).toEqual({ buffer: "c", cycleOnly: false });
  });

  it("appends within the reset window", () => {
    expect(appendAppSelectTypeaheadBuffer("1", "2", 100)).toEqual({
      buffer: "12",
      cycleOnly: false,
    });
  });

  it("cycles when the same single character is typed again", () => {
    expect(appendAppSelectTypeaheadBuffer("3", "3", 100)).toEqual({
      buffer: "3",
      cycleOnly: true,
    });
  });
});

describe("findEnabledAppSelectTypeaheadIndex", () => {
  const options = [
    { value: "1", label: "1 day" },
    { value: "3", label: "3 days" },
    { value: "30", label: "30 days" },
    { value: "5", label: "5 days" },
  ];

  it("jumps to the first label prefix match", () => {
    expect(findEnabledAppSelectTypeaheadIndex(options, "3", -1, false)).toBe(1);
  });

  it("cycles single-character matches on repeat", () => {
    expect(findEnabledAppSelectTypeaheadIndex(options, "3", 1, true)).toBe(2);
  });

  it("returns -1 when nothing matches", () => {
    expect(findEnabledAppSelectTypeaheadIndex(options, "9", -1, false)).toBe(-1);
  });
});
