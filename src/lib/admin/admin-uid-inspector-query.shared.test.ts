import { describe, expect, it } from "vitest";

import {
  buildAdminUidInspectorSearchParams,
  parseAdminUidInspectorQueryParams,
  validateAdminUidInspectorGameUid,
} from "@/lib/admin/admin-uid-inspector-query.shared";

describe("parseAdminUidInspectorQueryParams", () => {
  it("strips whitespace from gameUid", () => {
    expect(
      parseAdminUidInspectorQueryParams(
        new URLSearchParams("gameUid=1234%20567890123456"),
      ),
    ).toEqual({
      gameUid: "1234567890123456",
      allianceIdForRoster: undefined,
    });
  });

  it("passes allianceIdForRoster through", () => {
    expect(
      parseAdminUidInspectorQueryParams(
        new URLSearchParams(
          "gameUid=123456789012&allianceIdForRoster=alliance-abc",
        ),
      ),
    ).toEqual({
      gameUid: "123456789012",
      allianceIdForRoster: "alliance-abc",
    });
  });
});

describe("buildAdminUidInspectorSearchParams", () => {
  it("round-trips non-empty fields", () => {
    const qs = buildAdminUidInspectorSearchParams({
      gameUid: "1234567890123456",
      allianceIdForRoster: "a1",
    });
    expect(parseAdminUidInspectorQueryParams(new URLSearchParams(qs))).toEqual({
      gameUid: "1234567890123456",
      allianceIdForRoster: "a1",
    });
  });
});

describe("validateAdminUidInspectorGameUid", () => {
  it("rejects missing uid", () => {
    expect(validateAdminUidInspectorGameUid(undefined)).toEqual({
      ok: false,
      error: "missing",
    });
  });

  it("rejects invalid uid length", () => {
    expect(validateAdminUidInspectorGameUid("123")).toEqual({
      ok: false,
      error: "invalid",
    });
  });

  it("accepts 12–16 digit uid", () => {
    expect(validateAdminUidInspectorGameUid("123456789012")).toEqual({
      ok: true,
      gameUid: "123456789012",
    });
  });
});
