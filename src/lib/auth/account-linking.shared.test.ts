import { describe, expect, it } from "vitest";

import {
  canUnlinkOAuthProvider,
  countSignInMethods,
  linkedProvidersFromOAuthAccounts,
  mayAutoLinkOAuthAtSignIn,
  normalizeOAuthProviderEmail,
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

  it("blocks Google cold sign-in when email does not match", () => {
    expect(
      mayAutoLinkOAuthAtSignIn({
        provider: "google",
        oauthEmail: "other@example.com",
        emailVerified: true,
        hqUserEmail: "player@example.com",
        hasExistingOAuthLink: false,
      }),
    ).toBe("block_sign_in_with_hq_email");
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

  it("blocks Discord cold sign-in when email does not match HQ user", () => {
    expect(
      mayAutoLinkOAuthAtSignIn({
        provider: "discord",
        oauthEmail: "other@example.com",
        emailVerified: true,
        hqUserEmail: "player@example.com",
        hasExistingOAuthLink: false,
      }),
    ).toBe("block_sign_in_with_hq_email");
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

describe("normalizeOAuthProviderEmail", () => {
  it("normalizes and trims provider emails", () => {
    expect(normalizeOAuthProviderEmail(" Player@Example.com ")).toBe(
      "player@example.com",
    );
    expect(normalizeOAuthProviderEmail("")).toBeNull();
    expect(normalizeOAuthProviderEmail(null)).toBeNull();
  });
});

describe("linkedProvidersFromOAuthAccounts", () => {
  it("returns provider names in order", () => {
    expect(
      linkedProvidersFromOAuthAccounts([
        {
          provider: "discord",
          providerAccountId: "1",
          providerEmail: "discord@example.com",
        },
        {
          provider: "google",
          providerAccountId: "2",
          providerEmail: null,
        },
      ]),
    ).toEqual(["discord", "google"]);
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
        oauthAccounts: [
          {
            provider: "google",
            providerAccountId: "g1",
            providerEmail: null,
          },
        ],
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
          oauthAccounts: [
            {
              provider: "google",
              providerAccountId: "g1",
              providerEmail: null,
            },
          ],
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
          oauthAccounts: [
            {
              provider: "google",
              providerAccountId: "g1",
              providerEmail: null,
            },
          ],
        },
        "google",
      ),
    ).toBe(true);
  });
});
