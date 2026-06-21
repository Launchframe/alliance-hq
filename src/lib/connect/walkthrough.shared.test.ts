import { describe, expect, it } from "vitest";

import { shouldShowShellConnectPrompt } from "./walkthrough.shared";

describe("shouldShowShellConnectPrompt", () => {
  it("hides for users who never connected on this device", () => {
    expect(
      shouldShowShellConnectPrompt({
        hasAppAccess: true,
        isConnected: false,
        canUseAshedEmbeds: true,
        ashedConnectedOnDeviceBefore: false,
      }),
    ).toBe(false);
  });

  it("shows once for returning users who disconnected", () => {
    expect(
      shouldShowShellConnectPrompt({
        hasAppAccess: true,
        isConnected: false,
        canUseAshedEmbeds: true,
        ashedConnectedOnDeviceBefore: true,
      }),
    ).toBe(true);
  });

  it("hides when already connected", () => {
    expect(
      shouldShowShellConnectPrompt({
        hasAppAccess: true,
        isConnected: true,
        canUseAshedEmbeds: true,
        ashedConnectedOnDeviceBefore: true,
      }),
    ).toBe(false);
  });

  it("hides when Ashed embeds are not available", () => {
    expect(
      shouldShowShellConnectPrompt({
        hasAppAccess: true,
        isConnected: false,
        canUseAshedEmbeds: false,
        ashedConnectedOnDeviceBefore: true,
      }),
    ).toBe(false);
  });
});
