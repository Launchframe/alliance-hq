import { describe, expect, it } from "vitest";

import {
  DISCORD_COMMANDER_LINK_COMMANDS,
  DISCORD_LANGUAGE_SLASH_COMMANDS,
  DISCORD_VR_SLASH_COMMANDS,
  isDiscordCommanderLinkCommand,
  isDiscordLanguageSlashCommand,
  isDiscordVrSlashCommand,
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

describe("isDiscordVrSlashCommand", () => {
  it("matches VR slash commands and aliases", () => {
    for (const name of DISCORD_VR_SLASH_COMMANDS) {
      expect(isDiscordVrSlashCommand(name)).toBe(true);
    }
  });

  it("does not treat unrelated commands as VR reporting", () => {
    expect(isDiscordVrSlashCommand("weekly-pass")).toBe(false);
    expect(isDiscordVrSlashCommand(undefined)).toBe(false);
  });
});

describe("isDiscordLanguageSlashCommand", () => {
  it("matches language slash commands and aliases", () => {
    for (const name of DISCORD_LANGUAGE_SLASH_COMMANDS) {
      expect(isDiscordLanguageSlashCommand(name)).toBe(true);
    }
  });

  it("does not treat unrelated commands as language selection", () => {
    expect(isDiscordLanguageSlashCommand("help")).toBe(false);
    expect(isDiscordLanguageSlashCommand(undefined)).toBe(false);
  });
});
