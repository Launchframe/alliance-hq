import { describe, expect, it } from "vitest";

import {
  resolvePromptTemplateBody,
  resolvePromptTemplateBodyWithLegacy,
} from "@/lib/trains/prompt-resolution.shared";

describe("resolvePromptTemplateBody", () => {
  it("substitutes dotted variables", () => {
    const result = resolvePromptTemplateBody(
      "{{commander.name}} on a golden train in {{alliance.tag}}",
      {
        commander: { name: "Alice" },
        alliance: { name: "Legion", tag: "LFgo" },
        seasonKey: "5",
        conductorMechanism: "vs_top_10",
      },
    );
    expect(result).toBe("Alice on a golden train in LFgo");
  });

  it("leaves unknown variables empty", () => {
    const result = resolvePromptTemplateBody("Hello {{commander.bio}}", {
      commander: { name: "Bob" },
      alliance: { name: "X", tag: "X" },
      seasonKey: null,
      conductorMechanism: null,
    });
    expect(result).toBe("Hello ");
  });
});

describe("resolvePromptTemplateBodyWithLegacy", () => {
  it("maps snake_case season_key to seasonKey context", () => {
    const result = resolvePromptTemplateBodyWithLegacy(
      "Wild west season {{season_key}} for {{commander.name}}",
      {
        commander: { name: "Carol" },
        alliance: { name: "Y", tag: "Y" },
        seasonKey: "5",
        conductorMechanism: "r3_lottery",
      },
    );
    expect(result).toContain("Carol");
    expect(result).toContain("5");
  });
});
