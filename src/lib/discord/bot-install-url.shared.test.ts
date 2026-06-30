import { describe, expect, it } from "vitest";

import {
  DISCORD_BOT_INVITE_PERMISSIONS,
  buildDiscordBotInstallUrl,
} from "@/lib/discord/bot-install-url.shared";

describe("buildDiscordBotInstallUrl", () => {
  it("returns null when client id is empty", () => {
    expect(buildDiscordBotInstallUrl({ clientId: "" })).toBeNull();
    expect(buildDiscordBotInstallUrl({ clientId: "   " })).toBeNull();
  });

  it("builds a Discord install URL with bot + applications.commands scopes", () => {
    const url = buildDiscordBotInstallUrl({ clientId: "1234567890" });
    expect(url).not.toBeNull();
    const parsed = new URL(url!);
    expect(parsed.origin + parsed.pathname).toBe(
      "https://discord.com/api/oauth2/authorize",
    );
    expect(parsed.searchParams.get("client_id")).toBe("1234567890");
    expect(parsed.searchParams.get("scope")).toBe("bot applications.commands");
    expect(parsed.searchParams.get("permissions")).toBe(
      String(DISCORD_BOT_INVITE_PERMISSIONS),
    );
  });

  it("accepts a custom permissions bitmask", () => {
    const url = buildDiscordBotInstallUrl({
      clientId: "abc",
      permissions: 2048,
    });
    expect(new URL(url!).searchParams.get("permissions")).toBe("2048");
  });
});
