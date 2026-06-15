import { describe, expect, it } from "vitest";

import { buildDiscordReleaseEmbed } from "./discord";

describe("buildDiscordReleaseEmbed", () => {
  it("includes summary and breaking fields", () => {
    const payload = buildDiscordReleaseEmbed(
      {
        version: "0.2.0",
        title: "VR bot",
        summary: "Discord slash commands for viral resistance.",
        bodyMarkdown: "## Summary\n\nDiscord slash commands.",
        breaking: ["Officers must re-link Discord accounts"],
        shippedAt: "2026-06-15T12:00:00.000Z",
      },
      { releasesUrl: "https://alliance-hq.vercel.app/releases" },
    );

    expect(payload.embeds[0]?.title).toContain("0.2.0");
    expect(payload.embeds[0]?.description).toContain("Discord slash commands");
    expect(payload.embeds[0]?.fields?.[0]?.name).toBe("Breaking changes");
    expect(payload.embeds[0]?.url).toBe(
      "https://alliance-hq.vercel.app/releases",
    );
  });
});
