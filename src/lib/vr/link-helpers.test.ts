import { describe, expect, it } from "vitest";

import { advanceLinkWalkthrough } from "@/lib/vr/link-helpers";

const steps = ["Open the game.", "Copy your name.", "Run /link again."];
const translate = (key: string) => key;

describe("advanceLinkWalkthrough", () => {
  it("moves the arrow to the next step", () => {
    const result = advanceLinkWalkthrough({ step: 0, translate, steps });
    expect(result.pending).toEqual({ kind: "link_walkthrough", step: 1 });
    expect(result.reply).toContain("→ Copy your name.");
    expect(result.reply).not.toContain("→ Open the game.");
  });

  it("clears pending after the final step", () => {
    const result = advanceLinkWalkthrough({ step: 2, translate, steps });
    expect(result.pending).toBeNull();
    expect(result.reply).toBe("link.walkthroughDone");
  });
});
