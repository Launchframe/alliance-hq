import { describe, expect, it } from "vitest";

import { resolveWelcomeRedirect } from "./welcome-redirect.shared";

describe("resolveWelcomeRedirect", () => {
  it("routes join/claim codes to /join with the code preserved", () => {
    expect(
      resolveWelcomeRedirect({
        tag: "Roar",
        code: "ROAR-6CCE91",
      }),
    ).toBe("/join?code=ROAR-6CCE91");
  });

  it("URL-encodes join codes that need it", () => {
    expect(resolveWelcomeRedirect({ code: "ab c" })).toBe(
      "/join?code=ab%20c",
    );
  });

  it("routes invite tokens to /invite/<token>", () => {
    expect(
      resolveWelcomeRedirect({
        invite: "abc123TOKEN_with-dash",
      }),
    ).toBe("/invite/abc123TOKEN_with-dash");
  });

  it("prefers invite over code when both are present", () => {
    expect(
      resolveWelcomeRedirect({
        invite: "invitetokenabcdefghijklmnopqrstuv",
        code: "ROAR-1",
      }),
    ).toBe("/invite/invitetokenabcdefghijklmnopqrstuv");
  });

  it("rejects invite tokens with path separators", () => {
    expect(resolveWelcomeRedirect({ invite: "../evil" })).toBe("/get-started");
    expect(resolveWelcomeRedirect({ invite: "a/b" })).toBe("/get-started");
  });

  it("falls back to get-started when params are empty", () => {
    expect(resolveWelcomeRedirect({})).toBe("/get-started");
    expect(resolveWelcomeRedirect({ tag: "Roar" })).toBe("/get-started");
    expect(resolveWelcomeRedirect({ code: "  " })).toBe("/get-started");
  });
});
