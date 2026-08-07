import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchDiscordChannelName,
  fetchDiscordGuildName,
} from "@/lib/discord/guild-metadata.server";

describe("fetchDiscordGuildName", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.DISCORD_BOT_TOKEN;
  });

  it("returns null without bot token", async () => {
    await expect(fetchDiscordGuildName("guild-1")).resolves.toBeNull();
  });

  it("returns guild name on success", async () => {
    process.env.DISCORD_BOT_TOKEN = "test-token";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ name: "Alliance HQ" }),
      }),
    );

    await expect(fetchDiscordGuildName("guild-1")).resolves.toBe("Alliance HQ");
  });
});

describe("fetchDiscordChannelName", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.DISCORD_BOT_TOKEN;
  });

  it("returns channel name on success", async () => {
    process.env.DISCORD_BOT_TOKEN = "test-token";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ name: "train-announcements" }),
      }),
    );

    await expect(fetchDiscordChannelName("chan-1")).resolves.toBe(
      "train-announcements",
    );
  });
});
