import { describe, expect, it } from "vitest";

import {
  DISCORD_BOT_GUIDE_ROLE_SLUGS,
  DISCORD_BOT_GUIDE_ROLE_STEPS,
  buildDiscordBotGuidePath,
  buildDiscordBotGuideUrl,
  getDiscordBotGuideStep,
  helpMessageKeyToGuideRole,
  isDiscordBotGuideRoleSlug,
  isStepInRole,
  stepSlugToMessageKey,
} from "@/lib/guides/discord-bot-guide.shared";

describe("discord-bot-guide.shared", () => {
  it("maps step slugs to camelCase message keys", () => {
    expect(stepSlugToMessageKey("link-self")).toBe("linkSelf");
    expect(stepSlugToMessageKey("register-guild")).toBe("registerGuild");
  });

  it("defines steps for every role entry", () => {
    for (const role of DISCORD_BOT_GUIDE_ROLE_SLUGS) {
      for (const step of DISCORD_BOT_GUIDE_ROLE_STEPS[role]) {
        expect(getDiscordBotGuideStep(step)).not.toBeNull();
        expect(isStepInRole(role, step)).toBe(true);
      }
    }
  });

  it("rejects unknown role slugs", () => {
    expect(isDiscordBotGuideRoleSlug("r6")).toBe(false);
    expect(isStepInRole("member", "register-guild")).toBe(false);
  });

  it("builds locale-aware guide paths", () => {
    expect(buildDiscordBotGuidePath("en-US")).toBe("/guides/discord-bot");
    expect(buildDiscordBotGuidePath("pt-BR", { role: "r5" })).toBe(
      "/pt-BR/guides/discord-bot/r5",
    );
    expect(
      buildDiscordBotGuidePath("en-US", { role: "link-only", step: "link-self" }),
    ).toBe("/guides/discord-bot/link-only/link-self");
  });

  it("builds absolute guide URLs from NEXT_PUBLIC_APP_URL", () => {
    const prev = process.env.NEXT_PUBLIC_APP_URL;
    process.env.NEXT_PUBLIC_APP_URL = "https://frontline.gay";
    try {
      expect(buildDiscordBotGuideUrl("en-US", { role: "member" })).toBe(
        "https://frontline.gay/guides/discord-bot/member",
      );
    } finally {
      process.env.NEXT_PUBLIC_APP_URL = prev;
    }
  });

  it("maps help keys to guide roles", () => {
    expect(helpMessageKeyToGuideRole("help.linkCommander")).toBe("link-only");
    expect(helpMessageKeyToGuideRole("help.memberReady")).toBe("member");
    expect(helpMessageKeyToGuideRole("help.ownerReady")).toBe("r5");
    expect(helpMessageKeyToGuideRole("help.setupOwnerLinkHq")).toBe("r5");
    expect(helpMessageKeyToGuideRole("help.dmGeneral")).toBeUndefined();
  });
});
