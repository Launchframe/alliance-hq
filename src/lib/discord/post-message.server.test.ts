import { describe, expect, it } from "vitest";

import {
  postDiscordChannelMessage,
  truncateDiscordContent,
} from "@/lib/discord/post-message.server";

describe("truncateDiscordContent", () => {
  it("passes through short content", () => {
    expect(truncateDiscordContent("hello")).toBe("hello");
  });

  it("truncates long content with a marker", () => {
    const long = "x".repeat(2000);
    const result = truncateDiscordContent(long);
    expect(result.length).toBeLessThanOrEqual(1900);
    expect(result).toMatch(/_\(truncated\)_$/);
  });
});

describe("postDiscordChannelMessage", () => {
  it("returns false when bot token is missing", async () => {
    const original = process.env.DISCORD_BOT_TOKEN;
    delete process.env.DISCORD_BOT_TOKEN;
    await expect(postDiscordChannelMessage("channel", "hello")).resolves.toBe(false);
    if (original) process.env.DISCORD_BOT_TOKEN = original;
  });
});
