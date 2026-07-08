import { afterEach, describe, expect, it } from "vitest";

import { getDiscordBotInstallRedirectUri } from "@/lib/discord/bot-install-url.server";

describe("getDiscordBotInstallRedirectUri", () => {
  const envKeys = ["NEXT_PUBLIC_APP_URL", "VERCEL_URL"] as const;
  const prev: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const key of envKeys) {
      if (prev[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = prev[key];
      }
    }
  });

  it("uses shared discordBotAppOrigin (locale-free OAuth callback)", () => {
    prev.NEXT_PUBLIC_APP_URL = process.env.NEXT_PUBLIC_APP_URL;
    process.env.NEXT_PUBLIC_APP_URL = "https://frontline.gay/";

    expect(getDiscordBotInstallRedirectUri()).toBe(
      "https://frontline.gay/discord/install/complete",
    );
  });
});
