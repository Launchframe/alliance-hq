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
    expect(inviteAcceptReasonFromMessage("Something unexpected")).toBe(
      "accept_failed",
    );
  });
});

describe("inviteAcceptReasonFromApiCode", () => {
  it("maps API codes", () => {
    expect(inviteAcceptReasonFromApiCode("auth_required")).toBe("auth_required");
    expect(inviteAcceptReasonFromApiCode("email_mismatch")).toBe("email_mismatch");
    expect(inviteAcceptReasonFromApiCode(undefined)).toBe("accept_failed");
  });
});
