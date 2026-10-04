import { describe, expect, it } from "vitest";

import {
  DISCORD_MEMBER_LINK_GAME_UID_UNIQUE,
  HQ_MEMBER_LINK_GAME_UID_UNIQUE,
  isMemberLinkGameUidUniqueViolation,
} from "./member-link-game-uid-unique.shared";

describe("isMemberLinkGameUidUniqueViolation", () => {
  it("detects hq (alliance_id, game_uid) unique races", () => {
    expect(
      isMemberLinkGameUidUniqueViolation({
        code: "23505",
        constraint: HQ_MEMBER_LINK_GAME_UID_UNIQUE,
      }),
    ).toBe(true);
  });

  it("detects discord (alliance_id, game_uid) unique races", () => {
    expect(
      isMemberLinkGameUidUniqueViolation({
        code: "23505",
        constraint: DISCORD_MEMBER_LINK_GAME_UID_UNIQUE,
      }),
    ).toBe(true);
  });

  it("treats bare 23505 from link writes as a claim conflict", () => {
    expect(isMemberLinkGameUidUniqueViolation({ code: "23505" })).toBe(true);
  });

  it("ignores non-unique errors", () => {
    expect(
      isMemberLinkGameUidUniqueViolation(new Error("connection reset")),
    ).toBe(false);
    expect(
      isMemberLinkGameUidUniqueViolation({ code: "23503", constraint: "fk" }),
    ).toBe(false);
  });
});
