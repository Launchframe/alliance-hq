import { describe, expect, it } from "vitest";

import {
  resolveDiscordHelpContext,
  resolveWebHelpContext,
} from "./member-link-help-queue.server";

describe("member link help context", () => {
  it("maps roster_miss pending to roster_miss context", () => {
    expect(
      resolveWebHelpContext({ kind: "link_roster_miss" }),
    ).toBe("roster_miss");
    expect(
      resolveDiscordHelpContext({ kind: "link_roster_miss" }),
    ).toBe("roster_miss");
  });

  it("maps walkthrough pending to walkthrough context", () => {
    expect(
      resolveWebHelpContext({
        kind: "link_walkthrough",
        step: 1,
      } as { kind: string }),
    ).toBe("walkthrough");
  });

  it("defaults web to onboarding_form and discord to discord_button", () => {
    expect(resolveWebHelpContext(null)).toBe("onboarding_form");
    expect(resolveDiscordHelpContext(null)).toBe("discord_button");
  });
});
