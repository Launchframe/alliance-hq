import { describe, expect, it } from "vitest";

import { pickHelpMessageKey } from "@/lib/vr/bot-user-context";
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

  it("prompts owner auth when guild is not registered", () => {
    expect(
      pickHelpMessageKey(ctx({ guildRegistered: false, hasAnyMemberLink: false })),
    ).toBe("help.setupOwnerAuth");
  });

  it("prompts link-alliance when user already linked elsewhere", () => {
    expect(
      pickHelpMessageKey(ctx({ guildRegistered: false, hasAnyMemberLink: true })),
    ).toBe("help.setupLinkAlliance");
  });

  it("prompts /link when guild is ready but user is not linked", () => {
    expect(pickHelpMessageKey(ctx({ memberLinkCount: 0 }))).toBe(
      "help.linkProfile",
    );
  });

  it("shows multi-character member help", () => {
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
  it("maps wait state when credentials are missing", () => {
    expect(
      pickHelpMessageKey(
        ctx({ hasCredentials: false, isOwner: false, memberLinkCount: 0 }),
      ),
    ).toBe("help.waitForOwnerAuth");
  });
});
