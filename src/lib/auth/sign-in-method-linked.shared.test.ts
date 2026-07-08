import { describe, expect, it } from "vitest";

import {
  canRemovePasskeys,
  resolveSignInMethodLinkedFlags,
} from "@/lib/auth/sign-in-method-linked.shared";

describe("resolveSignInMethodLinkedFlags", () => {
  it("maps snapshot fields to linked flags", () => {
    expect(
      resolveSignInMethodLinkedFlags({
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
    ).toEqual({
      google: true,
      discord: false,
      passkey: true,
      email: true,
    });
  });

  it("treats empty email as not linked", () => {
    expect(
      resolveSignInMethodLinkedFlags({
        email: "   ",
        hasPassword: false,
        passkeyCount: 0,
        linkedProviders: [],
        oauthAccounts: [],
      }).email,
    ).toBe(false);
  });
});

describe("canRemovePasskeys", () => {
  it("blocks removal when passkeys are the only sign-in method", () => {
    expect(
      canRemovePasskeys({
        email: "",
        hasPassword: false,
        passkeyCount: 1,
        linkedProviders: [],
        oauthAccounts: [],
      }),
    ).toBe(false);
  });

  it("allows removal when another method remains", () => {
    expect(
      canRemovePasskeys({
        email: "player@example.com",
        hasPassword: false,
        passkeyCount: 1,
        linkedProviders: [],
        oauthAccounts: [],
      }),
    ).toBe(true);
  });
});
