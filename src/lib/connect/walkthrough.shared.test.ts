import { describe, expect, it } from "vitest";

import { shouldShowShellConnectPrompt } from "./walkthrough.shared";

describe("shouldShowShellConnectPrompt", () => {
  const base = {
    hasAppAccess: true,
    isConnected: false,
    canUseAshedEmbeds: true,
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

  it("hides when Ashed embeds are not available", () => {
    expect(
      shouldShowShellConnectPrompt({ ...base, canUseAshedEmbeds: false }),
    ).toBe(false);
  });

  it("hides when user dismissed connect nudges", () => {
    expect(
      shouldShowShellConnectPrompt({ ...base, dismissed: true }),
    ).toBe(false);
  });
});
