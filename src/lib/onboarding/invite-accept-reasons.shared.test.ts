import { describe, expect, it } from "vitest";

import {
  inviteAcceptReasonFromApiCode,
  inviteAcceptReasonFromMessage,
} from "./invite-accept-reasons.shared";

describe("inviteAcceptReasonFromMessage", () => {
  it("maps known invite errors to stable reason codes", () => {
    expect(inviteAcceptReasonFromMessage("Invite has expired.")).toBe(
      "invite_expired",
    );
    expect(inviteAcceptReasonFromMessage("Incorrect passphrase.")).toBe(
      "passphrase_incorrect",
    );
    expect(
      inviteAcceptReasonFromMessage(
        "Owner invite requires the claim commander to still be in-game R5.",
      ),
    ).toBe("hybrid_rank_stale");
    expect(inviteAcceptReasonFromMessage("Something unexpected")).toBe(
      "accept_failed",
    );
    expect(
      inviteAcceptReasonFromMessage(
        "This commander is already linked to an account.",
      ),
    ).toBe("commander_already_claimed");
  });
});

describe("inviteAcceptReasonFromApiCode", () => {
  it("maps API codes", () => {
    expect(inviteAcceptReasonFromApiCode("auth_required")).toBe("auth_required");
    expect(inviteAcceptReasonFromApiCode("email_mismatch")).toBe("email_mismatch");
    expect(inviteAcceptReasonFromApiCode("commander_already_claimed")).toBe(
      "commander_already_claimed",
    );
    expect(inviteAcceptReasonFromApiCode(undefined)).toBe("accept_failed");
  });
});
