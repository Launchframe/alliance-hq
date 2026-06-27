import { describe, expect, it } from "vitest";

import {
  DISCORD_COMMANDER_LINK_COMMANDS,
  isDiscordCommanderLinkCommand,
} from "@/lib/vr/discord-command-names";

describe("isDiscordCommanderLinkCommand", () => {
  it("matches commander link slash commands", () => {
    for (const name of DISCORD_COMMANDER_LINK_COMMANDS) {
      expect(isDiscordCommanderLinkCommand(name)).toBe(true);
    }
  });

  it("does not treat /link as commander linking", () => {
    expect(isDiscordCommanderLinkCommand("link")).toBe(false);
  });

  it("does not treat unrelated commands as commander linking", () => {
    expect(isDiscordCommanderLinkCommand("link-ashed")).toBe(false);
    expect(isDiscordCommanderLinkCommand("link-alliance")).toBe(false);
    expect(isDiscordCommanderLinkCommand(undefined)).toBe(false);
  });
});
