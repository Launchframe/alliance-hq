import { describe, expect, it } from "vitest";

import {
  formatLinkedOAuthProviderList,
  parseOAuthSignInRequiredSearchParams,
  resolveEmailSignInRestriction,
} from "./email-sign-in-restriction.shared";

const labels = { google: "Google", discord: "Discord" };

describe("resolveEmailSignInRestriction", () => {
  it("allows email sign-in for accounts without OAuth", () => {
    expect(
      resolveEmailSignInRestriction({
        email: "player@example.com",
        hasPassword: false,
        passkeyCount: 0,
        linkedProviders: [],
        oauthAccounts: [],
      }),
    ).toEqual({ blocked: false });
  });

  it("blocks OAuth-only Google accounts", () => {
    expect(
      resolveEmailSignInRestriction({
        email: "player@example.com",
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
      }),
    ).toEqual({
      blocked: true,
      email: "player@example.com",
      linkedProviders: ["google"],
    });
  });

  it("allows email sign-in when password is also set", () => {
    expect(
      resolveEmailSignInRestriction({
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
      }),
    ).toEqual({ blocked: false });
  });

  it("allows email sign-in when passkeys are also registered", () => {
    expect(
      resolveEmailSignInRestriction({
        email: "player@example.com",
        hasPassword: false,
        passkeyCount: 1,
        linkedProviders: ["discord"],
        oauthAccounts: [
          {
            provider: "discord",
            providerAccountId: "d1",
            providerEmail: null,
          },
        ],
      }),
    ).toEqual({ blocked: false });
  });
});

describe("formatLinkedOAuthProviderList", () => {
  it("formats one provider", () => {
    expect(formatLinkedOAuthProviderList(["google"], labels)).toBe("Google");
  });

  it("formats two providers", () => {
    expect(formatLinkedOAuthProviderList(["google", "discord"], labels)).toBe(
      "Google or Discord",
    );
  });
});

describe("parseOAuthSignInRequiredSearchParams", () => {
  it("parses OAuth sign-in required query params", () => {
    expect(
      parseOAuthSignInRequiredSearchParams({
        error: "OAuthSignInRequired",
        email: "player@example.com",
        providers: "google",
      }),
    ).toEqual({
      blocked: true,
      email: "player@example.com",
      linkedProviders: ["google"],
    });
  });
});
