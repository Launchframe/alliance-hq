import { afterEach, describe, expect, it, vi } from "vitest";

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
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns false when bot token is missing", async () => {
    const original = process.env.DISCORD_BOT_TOKEN;
    delete process.env.DISCORD_BOT_TOKEN;
    await expect(postDiscordChannelMessage("channel", "hello")).resolves.toBe(false);
    if (original) process.env.DISCORD_BOT_TOKEN = original;
  });

  it("returns false when fetch throws so claim-before-post crons can retry", async () => {
    process.env.DISCORD_BOT_TOKEN = "test-token";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("fetch failed")),
    );

    await expect(postDiscordChannelMessage("channel", "hello")).resolves.toBe(
      false,
    );
  });

  it("logs HTTP failures with status, source, and no duplicate risk", async () => {
    process.env.DISCORD_BOT_TOKEN = "test-token";
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"code":50013}', { status: 403 })),
    );
    await expect(
      postDiscordChannelMessage("chan-1", "hi", { source: "vs.daily_announcement" }),
    ).resolves.toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(
      "[discord] channel post failed",
      expect.objectContaining({
        source: "vs.daily_announcement",
        channelId: "chan-1",
        outcome: "http_error",
        status: 403,
        retryMayDuplicate: false,
      }),
    );
  });

  it("flags post-send network errors as possible duplicates", async () => {
    process.env.DISCORD_BOT_TOKEN = "test-token";
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("The operation timed out.", "TimeoutError");
      }),
    );
    await expect(postDiscordChannelMessage("chan-1", "hi")).resolves.toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(
      "[discord] channel post threw",
      expect.objectContaining({
        source: "unspecified",
        outcome: "network_error",
        errorName: "TimeoutError",
        retryMayDuplicate: true,
      }),
    );
  });

  it("does not flag connection-phase failures as possible duplicates", async () => {
    process.env.DISCORD_BOT_TOKEN = "test-token";
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed", {
          cause: Object.assign(new Error("connect ECONNREFUSED"), {
            code: "ECONNREFUSED",
          }),
        });
      }),
    );
    await expect(postDiscordChannelMessage("chan-1", "hi")).resolves.toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(
      "[discord] channel post threw",
      expect.objectContaining({
        errorCode: "ECONNREFUSED",
        retryMayDuplicate: false,
      }),
    );
  });
});
