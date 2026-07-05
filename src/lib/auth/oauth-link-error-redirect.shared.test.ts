import { describe, expect, it } from "vitest";

import { oauthAccountLinkErrorRedirect } from "./oauth-link-error-redirect.shared";

describe("oauthAccountLinkErrorRedirect", () => {
  it("returns /account linkError when linking started from /account", () => {
    expect(oauthAccountLinkErrorRedirect("/account?linked=google")).toBe(
      "/account?linkError=OAuthAccountNotLinked",
    );
  });

  it("returns /settings/account linkError when linking started from settings", () => {
    expect(
      oauthAccountLinkErrorRedirect("/settings/account?linked=discord"),
    ).toBe("/settings/account?linkError=OAuthAccountNotLinked");
  });

  it("preserves locale prefix on account paths", () => {
    expect(oauthAccountLinkErrorRedirect("/pt-BR/account?linked=google")).toBe(
      "/pt-BR/account?linkError=OAuthAccountNotLinked",
    );
  });

  it("accepts absolute callback URLs from the Auth.js cookie", () => {
    expect(
      oauthAccountLinkErrorRedirect(
        "https://frontline.gay/account?linked=google",
      ),
    ).toBe("/account?linkError=OAuthAccountNotLinked");
  });

  it("defaults to settings account for unknown or missing callbacks", () => {
    expect(oauthAccountLinkErrorRedirect(null)).toBe(
      "/settings/account?linkError=OAuthAccountNotLinked",
    );
    expect(oauthAccountLinkErrorRedirect("/trains")).toBe(
      "/settings/account?linkError=OAuthAccountNotLinked",
    );
    expect(oauthAccountLinkErrorRedirect("https://evil.com/phish")).toBe(
      "/settings/account?linkError=OAuthAccountNotLinked",
    );
  });
});
