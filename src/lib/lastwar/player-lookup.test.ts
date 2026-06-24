import { describe, expect, it } from "vitest";

import {
  isValidGameUid,
  normalizeLastWarAvatarUrl,
  parseGameServerNumberFromUid,
  parseLastWarLookupResponse,
} from "@/lib/lastwar/player-lookup";

describe("game UID validation", () => {
  it("accepts 12–16 digit UIDs for any state server suffix", () => {
    expect(isValidGameUid("1623941123001203")).toBe(true);
    expect(isValidGameUid("1001369694002891")).toBe(true);
    expect(isValidGameUid("123456789012")).toBe(true);
  });

  it("rejects non-numeric or wrong-length UIDs", () => {
    expect(isValidGameUid("abc")).toBe(false);
    expect(isValidGameUid("12345678901")).toBe(false);
    expect(isValidGameUid("12345678901234567")).toBe(false);
  });
});

describe("normalizeLastWarAvatarUrl", () => {
  it("prefixes relative paths with the Last War H5 origin", () => {
    expect(normalizeLastWarAvatarUrl("/avatars/x.png")).toBe(
      "https://lastwar-h5.lastwargame.com/avatars/x.png",
    );
  });
});

describe("parseGameServerNumberFromUid", () => {
  it("uses last four digits as state server number", () => {
    expect(parseGameServerNumberFromUid("1623941123001203")).toBe(1203);
    expect(parseGameServerNumberFromUid("1001369694002891")).toBe(2891);
  });
});

describe("parseLastWarLookupResponse", () => {
  it("maps code 103 to not found", () => {
    expect(parseLastWarLookupResponse({ code: 103 })).toMatchObject({
      ok: false,
      reason: "not_found",
    });
  });

  it("returns gameUserName on success (legacy data shape)", () => {
    expect(
      parseLastWarLookupResponse({
        code: 0,
        data: { gameUserName: "CommanderX" },
      }),
    ).toEqual({ ok: true, gameUserName: "CommanderX" });
  });

  it("returns gameUserName on success (platform result shape)", () => {
    expect(
      parseLastWarLookupResponse({
        code: 0,
        message: "ok",
        result: { server: "1203", gameUserName: "BOGGLE", gameUserLevel: "35" },
      }),
    ).toEqual({
      ok: true,
      gameUserName: "BOGGLE",
      gameUserLevel: 35,
      gameServerNumber: 1203,
    });
  });

  it("falls back to UID suffix for server number", () => {
    expect(
      parseLastWarLookupResponse(
        {
          code: 0,
          data: { gameUserName: "CommanderX" },
        },
        "1623941123001203",
      ),
    ).toMatchObject({
      ok: true,
      gameServerNumber: 1203,
    });
  });

  it("parses gameUserLevel from numeric or string values", async () => {
    const { parseLastWarGameUserLevel } = await import("@/lib/lastwar/player-lookup");
    expect(parseLastWarGameUserLevel("35")).toBe(35);
    expect(parseLastWarGameUserLevel(35.4)).toBe(35);
    expect(parseLastWarGameUserLevel("")).toBeNull();
  });

  it("builds platform lookup URL with uid query param", async () => {
    const { buildLastWarPlayerLookupUrl } = await import("@/lib/lastwar/player-lookup");
    expect(buildLastWarPlayerLookupUrl("1623941123001203")).toBe(
      "https://lastwar-platform.lastwargame.com/redemptionCode.php?method=login&uid=1623941123001203",
    );
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
