import { describe, expect, it } from "vitest";

import {
  TIME_OFF_MEMBER_SLASH_COMMANDS,
  TIME_OFF_OFFICER_SLASH_COMMANDS,
  TIME_OFF_SLASH_COMMANDS,
  isDiscordTimeOffOfficerSlashCommand,
  isDiscordTimeOffSlashCommand,
} from "@/lib/time-off/discord-command-names";

describe("isDiscordTimeOffSlashCommand", () => {
  it("matches every registered time-off slash command", () => {
    for (const name of TIME_OFF_SLASH_COMMANDS) {
      expect(isDiscordTimeOffSlashCommand(name)).toBe(true);
    }
  });

  it("does not treat unrelated commands as time-off commands", () => {
    expect(isDiscordTimeOffSlashCommand("vr")).toBe(false);
    expect(isDiscordTimeOffSlashCommand("set-conductor")).toBe(false);
    expect(isDiscordTimeOffSlashCommand(undefined)).toBe(false);
  });
});

describe("isDiscordTimeOffOfficerSlashCommand", () => {
  it("matches officer-gated time-off commands", () => {
    for (const name of TIME_OFF_OFFICER_SLASH_COMMANDS) {
      expect(isDiscordTimeOffOfficerSlashCommand(name)).toBe(true);
    }
  });

  it("does not treat member-facing time-off commands as officer commands", () => {
    for (const name of TIME_OFF_MEMBER_SLASH_COMMANDS) {
      expect(isDiscordTimeOffOfficerSlashCommand(name)).toBe(false);
    }
  });

  it("does not treat unrelated commands as officer time-off commands", () => {
    expect(isDiscordTimeOffOfficerSlashCommand(undefined)).toBe(false);
  });
});
