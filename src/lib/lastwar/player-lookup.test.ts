import { describe, expect, it } from "vitest";

import {
  isValidGameUid,
  parseLastWarLookupResponse,
} from "@/lib/lastwar/player-lookup";

describe("game UID validation", () => {
  it("accepts 12–16 digit UIDs ending in 1203", () => {
    expect(isValidGameUid("1623941123001203")).toBe(true);
  });

  it("rejects bad UIDs", () => {
    expect(isValidGameUid("abc")).toBe(false);
    expect(isValidGameUid("1623941123001204")).toBe(false);
  });
});

describe("parseLastWarLookupResponse", () => {
  it("maps code 103 to not found", () => {
    expect(parseLastWarLookupResponse({ code: 103 })).toMatchObject({
      ok: false,
      reason: "not_found",
    });
  });

  it("returns gameUserName on success", () => {
    expect(
      parseLastWarLookupResponse({
        code: 0,
        data: { gameUserName: "CommanderX" },
      }),
    ).toEqual({ ok: true, gameUserName: "CommanderX" });
  });
});
