import { describe, expect, it } from "vitest";

import {
  DEFAULT_INVITE_ACCEPT_REDIRECT,
  resolveInviteRedirect,
  sanitizeInternalRedirectPath,
} from "@/lib/navigation/safe-redirect.shared";

describe("sanitizeInternalRedirectPath", () => {
  it("accepts internal paths", () => {
    expect(sanitizeInternalRedirectPath("/trains")).toBe("/trains");
    expect(sanitizeInternalRedirectPath("/connect?welcome=1")).toBe(
      "/connect?welcome=1",
    );
  });

  it("rejects open redirects and unsafe values", () => {
    expect(sanitizeInternalRedirectPath("//evil.com")).toBeNull();
    expect(sanitizeInternalRedirectPath("https://evil.com")).toBeNull();
    expect(sanitizeInternalRedirectPath("/\\evil")).toBeNull();
    expect(sanitizeInternalRedirectPath("")).toBeNull();
    expect(sanitizeInternalRedirectPath(null)).toBeNull();
  });
});

describe("resolveInviteRedirect", () => {
  it("prefers query param over stored path", () => {
    expect(
      resolveInviteRedirect({
        queryNext: "/trains",
        storedPath: "/members",
      }),
    ).toBe("/trains");
  });

  it("falls back to stored path then default", () => {
    expect(resolveInviteRedirect({ storedPath: "/members" })).toBe("/members");
    expect(resolveInviteRedirect({})).toBe(DEFAULT_INVITE_ACCEPT_REDIRECT);
  });
});
