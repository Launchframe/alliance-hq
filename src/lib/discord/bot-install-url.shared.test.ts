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

  it("includes redirect_uri, response_type, and state when provided", () => {
    const url = buildDiscordBotInstallUrl({
      clientId: "abc",
      redirectUri: "https://hq.example.com/discord/install/complete",
      state: "nonce-123",
    });
    expect(url).not.toBeNull();
    const parsed = new URL(url!);
    expect(parsed.searchParams.get("redirect_uri")).toBe(
      "https://hq.example.com/discord/install/complete",
    );
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("state")).toBe("nonce-123");
  });
});
