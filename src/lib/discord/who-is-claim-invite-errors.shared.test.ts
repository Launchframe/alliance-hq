import { describe, expect, it } from "vitest";

import { whoIsClaimInviteFailedMessageKey } from "@/lib/discord/who-is-claim-invite-errors.shared";

describe("whoIsClaimInviteFailedMessageKey", () => {
  it("maps commander_not_found", () => {
    expect(whoIsClaimInviteFailedMessageKey("commander_not_found")).toBe(
      "whoIs.claimInviteFailedCommanderNotFound",
    );
  });

  it("maps commander_already_claimed", () => {
    expect(whoIsClaimInviteFailedMessageKey("commander_already_claimed")).toBe(
      "whoIs.claimInviteFailedCommanderAlreadyClaimed",
    );
  });
});
