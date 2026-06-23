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

  it("prompts HQ link when user has no discord_hq_links row", () => {
    expect(pickHelpMessageKey(ctx({ hasHqLink: false }))).toBe("help.setupLinkHq");
  });

  it("prompts owner auth when guild is not registered and no credentials", () => {
    expect(
      pickHelpMessageKey(
        ctx({
          guildRegistered: false,
          hasCredentials: false,
          userRegisteredCredentials: false,
        }),
      ),
    ).toBe("help.setupOwnerAuth");
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
  it("maps wait state when credentials are missing", () => {
    expect(
      pickHelpMessageKey(
        ctx({ hasCredentials: false, isOwner: false, memberLinkCount: 0 }),
      ),
    ).toBe("help.waitForOwnerAuth");
  });
});
