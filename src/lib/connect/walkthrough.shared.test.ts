import { describe, expect, it } from "vitest";

import { shouldShowShellConnectPrompt } from "./walkthrough.shared";

describe("shouldShowShellConnectPrompt", () => {
  const base = {
    hasAppAccess: true,
    isConnected: false,
    isAshedConnectAllowed: true,
    ashedConnectedOnDeviceBefore: true,
    dismissed: false,
  };

  it("hides for users who never connected on this device", () => {
    expect(
      shouldShowShellConnectPrompt({
        ...base,
        ashedConnectedOnDeviceBefore: false,
      }),
    ).toBe(false);
  });

  it("shows once for returning users who disconnected", () => {
    expect(shouldShowShellConnectPrompt(base)).toBe(true);
  });

  it("hides when already connected", () => {
    expect(
      shouldShowShellConnectPrompt({ ...base, isConnected: true }),
    ).toBe(false);
  });

  it("shows for HQ-only sessions without an active Ashed credential", () => {
    expect(shouldShowShellConnectPrompt(base)).toBe(true);
  });

  it("hides when connect is not allowed for the role", () => {
    expect(
      shouldShowShellConnectPrompt({ ...base, isAshedConnectAllowed: false }),
    ).toBe(false);
  });

  it("hides when user dismissed connect nudges", () => {
    expect(
      shouldShowShellConnectPrompt({ ...base, dismissed: true }),
    ).toBe(false);
  });
});
