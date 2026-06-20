import { describe, expect, it } from "vitest";

import {
  isValidGameUid,
  normalizeLastWarAvatarUrl,
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

describe("normalizeLastWarAvatarUrl", () => {
  it("prefixes relative paths with the Last War H5 origin", () => {
    expect(normalizeLastWarAvatarUrl("/avatars/x.png")).toBe(
      "https://lastwar-h5.lastwargame.com/avatars/x.png",
    );
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

  it("parses avatar URL from headPic", () => {
    expect(
      parseLastWarLookupResponse({
        code: 0,
        data: {
          gameUserName: "CommanderX",
          headPic: "/avatars/commander.png",
        },
      }),
    ).toEqual({
      ok: true,
      gameUserName: "CommanderX",
      avatarUrl: "https://lastwar-h5.lastwargame.com/avatars/commander.png",
    });
  });
});
