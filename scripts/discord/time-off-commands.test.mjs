import { describe, expect, it } from "vitest";
import { TIME_OFF_COMMANDS } from "./time-off-commands.mjs";
import { TIME_OFF_SLASH_COMMANDS } from "../../src/lib/time-off/discord-command-names.ts";

describe("time-off command registration", () => {
  it("registers exactly the commands handled by the webhook", () => {
    expect(TIME_OFF_COMMANDS.map((command) => command.name).sort()).toEqual([...TIME_OFF_SLASH_COMMANDS].sort());
    expect(new Set(TIME_OFF_COMMANDS.map((command) => command.name)).size).toBe(TIME_OFF_COMMANDS.length);
  });

  for (const command of TIME_OFF_COMMANDS) {
    it(`${command.name} has valid localized descriptions and required-option ordering`, () => {
      let optionalSeen = false;
      for (const node of [command, ...command.options]) {
        expect(node.description.length).toBeGreaterThan(0);
        expect(node.description.length).toBeLessThanOrEqual(100);
        expect(node.description_localizations["pt-BR"].length).toBeGreaterThan(0);
        expect(node.description_localizations["pt-BR"].length).toBeLessThanOrEqual(100);
        for (const choice of node.choices ?? []) expect(choice.name_localizations["pt-BR"]).toBeTruthy();
      }
      for (const option of command.options) {
        if (option.required) expect(optionalSeen).toBe(false);
        else optionalSeen = true;
      }
    });
  }
});
