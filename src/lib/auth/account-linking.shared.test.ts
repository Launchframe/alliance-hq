import { describe, expect, it } from "vitest";

import {
  canUnlinkOAuthProvider,
  countSignInMethods,
  mayAutoLinkOAuthAtSignIn,
  oauthEmailMatchesHqUserEmail,
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

  it("auto-links Discord when email matches an existing HQ user", () => {
    expect(
      mayAutoLinkOAuthAtSignIn({
        provider: "discord",
        oauthEmail: "player@example.com",
        emailVerified: false,
        hqUserEmail: "player@example.com",
        hasExistingOAuthLink: false,
      }),
    ).toBe("auto_link");
  });

  it("blocks Discord cold sign-in when Discord email is missing", () => {
    expect(
      mayAutoLinkOAuthAtSignIn({
        provider: "discord",
        oauthEmail: "",
        emailVerified: false,
        hqUserEmail: "player@example.com",
        hasExistingOAuthLink: false,
      }),
    ).toBe("block_discord_no_email");
  });

  it("blocks Discord when email does not match HQ user", () => {
    expect(
      mayAutoLinkOAuthAtSignIn({
        provider: "discord",
        oauthEmail: "other@example.com",
        emailVerified: true,
        hqUserEmail: "player@example.com",
        hasExistingOAuthLink: false,
      }),
    ).toBe("block_email_mismatch");
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

describe("oauthEmailMatchesHqUserEmail", () => {
  it("allows link when OAuth omits email", () => {
    expect(oauthEmailMatchesHqUserEmail(null, "player@example.com")).toBe(true);
    expect(oauthEmailMatchesHqUserEmail("", "player@example.com")).toBe(true);
  });

  it("requires matching emails when OAuth provides one", () => {
    expect(
      oauthEmailMatchesHqUserEmail(
        "Player@Example.com",
        "player@example.com",
      ),
    ).toBe(true);
    expect(
      oauthEmailMatchesHqUserEmail("other@example.com", "player@example.com"),
    ).toBe(false);
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
