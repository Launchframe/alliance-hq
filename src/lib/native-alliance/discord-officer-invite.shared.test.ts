import { describe, expect, it } from "vitest";

import {
  isValidDiscordUserId,
  normalizeDiscordUserId,
} from "./discord-officer-invite.shared";

describe("discord-officer-invite.shared", () => {
  it("accepts 17–20 digit Discord snowflakes", () => {
    expect(isValidDiscordUserId("12345678901234567")).toBe(true);
    expect(isValidDiscordUserId(" 1234567890123456789 ")).toBe(true);
    expect(normalizeDiscordUserId(" 1234567890123456789 ")).toBe(
      "1234567890123456789",
    );
  });

  it("rejects invalid Discord user IDs", () => {
    expect(isValidDiscordUserId("")).toBe(false);
    expect(isValidDiscordUserId("123")).toBe(false);
    expect(isValidDiscordUserId("not-a-snowflake")).toBe(false);
    expect(isValidDiscordUserId("123456789012345678901")).toBe(false);
  });
});
