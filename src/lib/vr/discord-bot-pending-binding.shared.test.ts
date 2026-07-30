import { describe, expect, it } from "vitest";

import {
  discordBotPendingMatchesCaller,
  gameUidFromDiscordLinkPending,
} from "@/lib/vr/discord-bot-pending-binding.shared";

describe("discordBotPendingMatchesCaller", () => {
  it("rejects when pending alliance differs from the caller alliance", () => {
    expect(
      discordBotPendingMatchesCaller({
        pendingAllianceId: "alliance-b",
        callerAllianceId: "alliance-a",
        pendingGameUid: "1234567890121203",
        expectedGameUid: "1234567890121203",
      }),
    ).toBe(false);
  });

  it("rejects when expected game UID does not match pending", () => {
    expect(
      discordBotPendingMatchesCaller({
        pendingAllianceId: "alliance-a",
        callerAllianceId: "alliance-a",
        pendingGameUid: "9999999999999999",
        expectedGameUid: "1234567890121203",
      }),
    ).toBe(false);
  });

  it("accepts matching alliance + expected UID", () => {
    expect(
      discordBotPendingMatchesCaller({
        pendingAllianceId: "alliance-a",
        callerAllianceId: "alliance-a",
        pendingGameUid: "1234567890121203",
        expectedGameUid: "1234567890121203",
      }),
    ).toBe(true);
  });

  it("allows missing expected UID (legacy Discord buttons) when alliance matches", () => {
    expect(
      discordBotPendingMatchesCaller({
        pendingAllianceId: "alliance-a",
        callerAllianceId: "alliance-a",
        pendingGameUid: "1234567890121203",
      }),
    ).toBe(true);
  });
});

describe("gameUidFromDiscordLinkPending", () => {
  it("returns trimmed UID when present", () => {
    expect(gameUidFromDiscordLinkPending({ gameUid: " 1234567890121203 " })).toBe(
      "1234567890121203",
    );
  });

  it("returns null when missing", () => {
    expect(gameUidFromDiscordLinkPending(null)).toBeNull();
    expect(gameUidFromDiscordLinkPending({})).toBeNull();
  });
});
