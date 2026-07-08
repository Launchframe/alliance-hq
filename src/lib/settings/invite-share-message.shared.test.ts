import { describe, expect, it } from "vitest";

import {
  buildClaimCodeShareMessage,
  buildInviteLinkShareMessage,
  buildJoinCodeShareMessage,
} from "@/lib/settings/invite-share-message.shared";

describe("invite share messages", () => {
  it("builds invite link message with optional passphrase", () => {
    const message = buildInviteLinkShareMessage({
      allianceName: "LFgo",
      inviteUrl: "https://hq.example/invite/abc",
      passphrase: "secret",
    });
    expect(message).toContain("LFgo");
    expect(message).toContain("https://hq.example/invite/abc");
    expect(message).toContain("secret");
  });

  it("builds join code message", () => {
    const message = buildJoinCodeShareMessage({
      allianceName: "LFgo",
      joinCode: "LFGO-A1B2C3",
    });
    expect(message).toContain("LFGO-A1B2C3");
    expect(message).toContain("/join");
  });

  it("builds claim code message", () => {
    const message = buildClaimCodeShareMessage({
      allianceName: "LFgo",
      joinCode: "LFGO-D4E5F6",
    });
    expect(message).toContain("claim your Commander");
    expect(message).toContain("LFGO-D4E5F6");
  });
});
