import { describe, expect, it } from "vitest";

import { pickHelpMessageKey, formatHelpReply } from "@/lib/vr/bot-user-context";
import type { DiscordBotUserContext } from "@/lib/vr/bot-user-context";

function ctx(
  overrides: Partial<DiscordBotUserContext>,
): DiscordBotUserContext {
  return {
    guildId: "guild-1",
    allianceId: "alliance-1",
    allianceTag: "LFgo",
    guildRegistered: true,
    hasCredentials: true,
    hasHqLink: true,
    isPlatformMaintainer: false,
    userRegisteredCredentials: false,
    memberLinks: [],
    memberLinkCount: 0,
    isOwner: false,
    hasAnyMemberLink: false,
    ...overrides,
  };
}

describe("pickHelpMessageKey", () => {
  it("guides DMs to general help", () => {
    expect(pickHelpMessageKey(ctx({ guildId: null }))).toBe("help.dmGeneral");
  });

  it("prompts link when guild is ready but user has no commanders", () => {
    expect(pickHelpMessageKey(ctx({ hasHqLink: false, memberLinkCount: 0 }))).toBe(
      "help.linkCommander",
    );
  });

  it("prompts HQ sign-in when guild is not registered and Discord has no HQ link", () => {
    expect(
      pickHelpMessageKey(
        ctx({
          guildRegistered: false,
          hasCredentials: false,
          hasHqLink: false,
          userRegisteredCredentials: false,
        }),
      ),
    ).toBe("help.setupOwnerLinkHq");
  });

  it("prompts link-commander when guild is not registered and Discord has HQ link but no commander", () => {
    expect(
      pickHelpMessageKey(
        ctx({
          guildRegistered: false,
          hasCredentials: false,
          hasHqLink: true,
          userRegisteredCredentials: false,
          hasAnyMemberLink: false,
        }),
      ),
    ).toBe("help.setupOwnerLinkCommander");
  });

  it("prompts link-alliance when guild is not registered and owner has a commander link", () => {
    expect(
      pickHelpMessageKey(
        ctx({
          guildRegistered: false,
          hasCredentials: false,
          hasHqLink: true,
          userRegisteredCredentials: false,
          hasAnyMemberLink: true,
        }),
      ),
    ).toBe("help.setupLinkAlliance");
  });

  it("prompts link-alliance when owner has credentials", () => {
    expect(
      pickHelpMessageKey(
        ctx({
          guildRegistered: false,
          userRegisteredCredentials: true,
        }),
      ),
    ).toBe("help.setupLinkAlliance");
  });

  it("prompts link-alliance for platform maintainers without credentials", () => {
    expect(
      pickHelpMessageKey(
        ctx({
          guildRegistered: false,
          hasCredentials: false,
          isPlatformMaintainer: true,
        }),
      ),
    ).toBe("help.setupLinkAlliance");
  });

  it("prompts link-commander when guild is ready but user has no commanders", () => {
    expect(pickHelpMessageKey(ctx({ memberLinkCount: 0 }))).toBe(
      "help.linkCommander",
    );
  });

  it("shows multi-commander member help", () => {
    expect(pickHelpMessageKey(ctx({ memberLinkCount: 2 }))).toBe(
      "help.memberReadyMulti",
    );
  });

  it("shows owner help when linked as owner", () => {
    expect(pickHelpMessageKey(ctx({ isOwner: true, memberLinkCount: 1 }))).toBe(
      "help.ownerReady",
    );
  });
});

describe("handleDiscordHelp message keys", () => {
  it("does not block registered-guild help on missing Ashed credentials", () => {
    expect(
      pickHelpMessageKey(
        ctx({ hasCredentials: false, isOwner: false, memberLinkCount: 0 }),
      ),
    ).toBe("help.linkCommander");
  });
});

describe("formatHelpReply", () => {
  it("includes role-scoped guideUrl for link-commander help", () => {
    const prev = process.env.NEXT_PUBLIC_APP_URL;
    process.env.NEXT_PUBLIC_APP_URL = "https://frontline.gay";
    try {
      const reply = formatHelpReply(
        (key, values) => `${key}:${values?.guideUrl ?? ""}`,
        "help.linkCommander",
        ctx({ memberLinkCount: 0 }),
        "en-US",
      );
      expect(reply).toBe(
        "help.linkCommander:https://frontline.gay/guides/discord-bot/link-only",
      );
    } finally {
      process.env.NEXT_PUBLIC_APP_URL = prev;
    }
  });

  it("uses hub guideUrl for dmGeneral without a role mapping", () => {
    const prev = process.env.NEXT_PUBLIC_APP_URL;
    process.env.NEXT_PUBLIC_APP_URL = "https://frontline.gay";
    try {
      const reply = formatHelpReply(
        (key, values) => `${key}:${values?.guideUrl ?? ""}`,
        "help.dmGeneral",
        ctx({ guildId: null }),
        "en-US",
      );
      expect(reply).toBe(
        "help.dmGeneral:https://frontline.gay/guides/discord-bot",
      );
    } finally {
      process.env.NEXT_PUBLIC_APP_URL = prev;
    }
  });
});
