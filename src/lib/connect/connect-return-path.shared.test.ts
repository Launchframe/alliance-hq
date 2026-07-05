import { describe, expect, it } from "vitest";

import {
  buildConnectHref,
  DEFAULT_CONNECT_RETURN_FALLBACK,
  parseConnectQueryReturn,
  resolveConnectReturnPath,
} from "@/lib/connect/connect-return-path.shared";

describe("parseConnectQueryReturn", () => {
  it("returns sanitized query paths only", () => {
    expect(parseConnectQueryReturn("/members")).toBe("/members");
    expect(parseConnectQueryReturn(undefined)).toBeUndefined();
    expect(parseConnectQueryReturn("https://evil.com")).toBeUndefined();
    expect(parseConnectQueryReturn("/connect")).toBeUndefined();
  });
});

describe("buildConnectHref", () => {
  it("encodes valid internal return paths", () => {
    expect(buildConnectHref("/members")).toBe("/connect?next=%2Fmembers");
    expect(buildConnectHref("/settings/team")).toBe(
      "/connect?next=%2Fsettings%2Fteam",
    );
  });

  it("returns bare /connect for invalid or connect self paths", () => {
    expect(buildConnectHref(null)).toBe("/connect");
    expect(buildConnectHref("")).toBe("/connect");
    expect(buildConnectHref("//evil.com")).toBe("/connect");
    expect(buildConnectHref("https://evil.com")).toBe("/connect");
    expect(buildConnectHref("/connect")).toBe("/connect");
  });
});

describe("resolveConnectReturnPath", () => {
  it("prefers query param over stash and fallback", () => {
    expect(
      resolveConnectReturnPath({
        queryNext: "/trains",
        stashedPath: "/members",
        fallback: "/dashboard",
      }),
    ).toBe("/trains");
  });

  it("uses stashed path when query is missing", () => {
    expect(
      resolveConnectReturnPath({
        stashedPath: "/members",
        fallback: "/dashboard",
      }),
    ).toBe("/members");
  });

  it("defaults to /members when nothing valid is provided", () => {
    expect(resolveConnectReturnPath({})).toBe(DEFAULT_CONNECT_RETURN_FALLBACK);
  });

  it("rejects external and unsafe paths", () => {
    expect(
      resolveConnectReturnPath({
        queryNext: "https://evil.com",
        stashedPath: "//evil.com",
        fallback: "/members",
      }),
    ).toBe("/members");
  });

  it("ignores /connect as a return destination", () => {
    expect(
      resolveConnectReturnPath({
        queryNext: "/connect",
        stashedPath: "/connect",
        fallback: "/members",
      }),
    ).toBe("/members");
  });
});
