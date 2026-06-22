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
    ).toEqual({ ok: true, gameUserName: "BOGGLE", gameUserLevel: 35 });
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
