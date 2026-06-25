import { describe, expect, it } from "vitest";

import {
  canUnlinkOAuthProvider,
  countSignInMethods,
  mayAutoLinkOAuthAtSignIn,
} from "./account-linking.shared";

describe("mayAutoLinkOAuthAtSignIn", () => {
  it("auto-links Google when verified email matches HQ user", () => {
    expect(
      mayAutoLinkOAuthAtSignIn({
        provider: "google",
        oauthEmail: "Player@Example.com",
        emailVerified: true,
        hqUserEmail: "player@example.com",
        hasExistingOAuthLink: false,
      }),
    ).toBe("auto_link");
  });

  it("blocks Google when email does not match", () => {
    expect(
      mayAutoLinkOAuthAtSignIn({
        provider: "google",
        oauthEmail: "other@example.com",
        emailVerified: true,
        hqUserEmail: "player@example.com",
        hasExistingOAuthLink: false,
      }),
    ).toBe("block_email_mismatch");
  });

  it("blocks Google when email is not verified", () => {
    expect(
      mayAutoLinkOAuthAtSignIn({
        provider: "google",
        oauthEmail: "player@example.com",
        emailVerified: false,
        hqUserEmail: "player@example.com",
        hasExistingOAuthLink: false,
      }),
    ).toBe("block_unverified");
  });

  it("blocks Discord cold sign-in when HQ user exists without a link", () => {
    expect(
      mayAutoLinkOAuthAtSignIn({
        provider: "discord",
        oauthEmail: "player@example.com",
        emailVerified: true,
        hqUserEmail: "player@example.com",
        hasExistingOAuthLink: false,
      }),
    ).toBe("block_discord_cold_signin");
  });

  it("allows when provider is already linked", () => {
    expect(
      mayAutoLinkOAuthAtSignIn({
        provider: "google",
        oauthEmail: "player@example.com",
        emailVerified: true,
        hqUserEmail: "player@example.com",
        hasExistingOAuthLink: true,
      }),
    ).toBe("allow");
  });
});

describe("countSignInMethods", () => {
  it("counts email, password, passkeys, and oauth providers", () => {
    expect(
      countSignInMethods({
        email: "player@example.com",
        hasPassword: true,
        passkeyCount: 2,
        linkedProviders: ["google"],
      }),
    ).toBe(4);
  });
});

describe("canUnlinkOAuthProvider", () => {
  it("blocks unlink when it would remove the last method", () => {
    expect(
      canUnlinkOAuthProvider(
        {
          email: "",
          hasPassword: false,
          passkeyCount: 0,
          linkedProviders: ["google"],
        },
        "google",
      ),
    ).toBe(false);
  });

  it("allows unlink when another method remains", () => {
    expect(
      canUnlinkOAuthProvider(
        {
          email: "player@example.com",
          hasPassword: true,
          passkeyCount: 0,
          linkedProviders: ["google"],
        },
        "google",
      ),
    ).toBe(true);
  });
});
