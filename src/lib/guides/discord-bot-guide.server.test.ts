import { describe, expect, it } from "vitest";

import { buildDiscordBotGuideUrl } from "@/lib/guides/discord-bot-guide.server";

describe("discord-bot-guide.server", () => {
  it("builds absolute guide URLs from NEXT_PUBLIC_APP_URL", () => {
    const prev = process.env.NEXT_PUBLIC_APP_URL;
    process.env.NEXT_PUBLIC_APP_URL = "https://frontline.gay";
    try {
      expect(buildDiscordBotGuideUrl("en-US", { role: "member" })).toBe(
        "https://frontline.gay/guides/discord-bot/member",
      );
      expect(buildDiscordBotGuideUrl("pt-BR")).toBe(
        "https://frontline.gay/pt-BR/guides/discord-bot",
      );
    } finally {
      process.env.NEXT_PUBLIC_APP_URL = prev;
    }
  });
});
