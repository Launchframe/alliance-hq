import { describe, expect, it } from "vitest";

import {
  canRefreshRosterFromAshed,
  shouldShowAshedConnectNudge,
} from "./ashed-shell-prompts.shared";

describe("shouldShowAshedConnectNudge", () => {
  const base = {
    hasAppAccess: true,
    isConnected: false,
    isAshedConnectAllowed: true,
    dismissed: false,
  };

  it("shows when not connected and not dismissed", () => {
    expect(shouldShowAshedConnectNudge(base)).toBe(true);
  });

  it("hides when connected", () => {
    expect(shouldShowAshedConnectNudge({ ...base, isConnected: true })).toBe(
      false,
    );
  });

  it("hides when dismissed", () => {
    expect(shouldShowAshedConnectNudge({ ...base, dismissed: true })).toBe(
      false,
    );
  });

  it("hides when connect is not allowed for the role", () => {
    expect(
      shouldShowAshedConnectNudge({ ...base, isAshedConnectAllowed: false }),
    ).toBe(false);
  });
});

describe("canRefreshRosterFromAshed", () => {
  it("requires ashed mode and a live credential", () => {
    expect(
      canRefreshRosterFromAshed({
        operatingMode: "ashed",
        isAshedConnected: true,
      }),
    ).toBe(true);
    expect(
      canRefreshRosterFromAshed({
        operatingMode: "ashed",
        isAshedConnected: false,
      }),
    ).toBe(false);
    expect(
      canRefreshRosterFromAshed({
        operatingMode: "native",
        isAshedConnected: true,
      }),
    ).toBe(false);
  });
});
