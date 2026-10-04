import { describe, expect, it } from "vitest";
import { PLUNDER_PLAN_COMMAND } from "./plunder-plan-commands.mjs";

describe("Plunder Plan command registration", () => {
  it("registers the approved localized command and complete self-service surface", () => {
    expect(PLUNDER_PLAN_COMMAND.name).toBe("plunder-plan");
    expect(PLUNDER_PLAN_COMMAND.description).toBe("Let your alliance know when you'll share secret tasks.");
    expect(PLUNDER_PLAN_COMMAND.dm_permission).toBe(false);
    expect(PLUNDER_PLAN_COMMAND.options.map((command) => command.name)).toEqual(expect.arrayContaining(["schedule", "my-plans", "plan", "join", "edit", "skip", "pause", "resume", "remove", "color", "suggestions", "notifications"]));
  });
  it("keeps all descriptions localized and within Discord limits", () => {
    function check(command) {
      expect(command.description.length).toBeLessThanOrEqual(100);
      expect(command.description_localizations["pt-BR"].length).toBeGreaterThan(0);
      expect(command.description_localizations["pt-BR"].length).toBeLessThanOrEqual(100);
      for (const option of command.options ?? []) check(option);
    }
    check(PLUNDER_PLAN_COMMAND);
  });
});
