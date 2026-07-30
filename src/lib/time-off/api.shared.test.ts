import { describe, expect, it } from "vitest";

import {
  canCancelTimeOffEntry,
  timeOffEntryKindRequiresWrite,
} from "@/lib/time-off/api.shared";

describe("timeOffEntryKindRequiresWrite", () => {
  it("marks officer-only kinds", () => {
    expect(timeOffEntryKindRequiresWrite("unexpected")).toBe(true);
    expect(timeOffEntryKindRequiresWrite("officer_marked")).toBe(true);
    expect(timeOffEntryKindRequiresWrite("planned")).toBe(false);
  });
});

describe("canCancelTimeOffEntry", () => {
  it("lets members cancel their own planned entries", () => {
    expect(
      canCancelTimeOffEntry({
        entryKind: "planned",
        canManageOthers: false,
        ownsCommander: true,
      }),
    ).toBe(true);
  });

  it("blocks members from cancelling officer unexpected flags", () => {
    expect(
      canCancelTimeOffEntry({
        entryKind: "unexpected",
        canManageOthers: false,
        ownsCommander: true,
      }),
    ).toBe(false);
  });

  it("blocks members from cancelling officer_marked entries", () => {
    expect(
      canCancelTimeOffEntry({
        entryKind: "officer_marked",
        canManageOthers: false,
        ownsCommander: true,
      }),
    ).toBe(false);
  });

  it("lets officers cancel any entry kind", () => {
    expect(
      canCancelTimeOffEntry({
        entryKind: "unexpected",
        canManageOthers: true,
        ownsCommander: false,
      }),
    ).toBe(true);
    expect(
      canCancelTimeOffEntry({
        entryKind: "planned",
        canManageOthers: true,
        ownsCommander: false,
      }),
    ).toBe(true);
  });

  it("blocks unrelated members", () => {
    expect(
      canCancelTimeOffEntry({
        entryKind: "planned",
        canManageOthers: false,
        ownsCommander: false,
      }),
    ).toBe(false);
  });
});
