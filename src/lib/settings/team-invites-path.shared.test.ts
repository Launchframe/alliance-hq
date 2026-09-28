import { describe, expect, it } from "vitest";

import { commanderClaimInvitesSettingsPath } from "@/lib/settings/team-invites-path.shared";

describe("commanderClaimInvitesSettingsPath", () => {
  it("opens the Invites tab and scrolls to the claim panel", () => {
    expect(commanderClaimInvitesSettingsPath()).toBe(
      "/settings/team?tab=invites#commander-claim-invites",
    );
  });
});
