import { afterEach, describe, expect, it } from "vitest";

import {
  buildDiscordBotAppUrl,
  discordBotAppOrigin,
  discordBotLocalePathPrefix,
} from "@/lib/discord/app-url.shared";

describe("discordBotAppUrl", () => {
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

  it("builds locale-prefixed absolute URLs", () => {
    prev.NEXT_PUBLIC_APP_URL = process.env.NEXT_PUBLIC_APP_URL;
    process.env.NEXT_PUBLIC_APP_URL = "https://frontline.gay/";

    expect(buildDiscordBotAppUrl("en-US", "/discord/authorize?nonce=abc")).toBe(
      "https://frontline.gay/discord/authorize?nonce=abc",
    );
    expect(
      buildDiscordBotAppUrl("pt-BR", "/discord/link-commander?nonce=xyz"),
    ).toBe("https://frontline.gay/pt-BR/discord/link-commander?nonce=xyz");
    expect(buildDiscordBotAppUrl("pt-BR", "/trains")).toBe(
      "https://frontline.gay/pt-BR/trains",
    );
  });

  it("exposes origin and locale prefix helpers", () => {
    prev.NEXT_PUBLIC_APP_URL = process.env.NEXT_PUBLIC_APP_URL;
    process.env.NEXT_PUBLIC_APP_URL = "https://frontline.gay";

    expect(discordBotAppOrigin()).toBe("https://frontline.gay");
    expect(discordBotLocalePathPrefix("en-US")).toBe("");
    expect(discordBotLocalePathPrefix("pt-BR")).toBe("/pt-BR");
  });
});
