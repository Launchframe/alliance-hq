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

  it("builds join code message with welcome URL", () => {
    const message = buildJoinCodeShareMessage({
      allianceName: "LFgo",
      welcomeUrl: "https://hq.example/welcome?tag=LFgo&code=LFGO-A1B2C3",
    });
    expect(message).toContain("https://hq.example/welcome");
    expect(message).not.toContain("/join");
  });

  it("builds claim code message with legacy join path", () => {
    const message = buildClaimCodeShareMessage({
      allianceName: "LFgo",
      joinCode: "LFGO-D4E5F6",
    });
    expect(message).toContain("claim your Commander");
    expect(message).toContain("LFGO-D4E5F6");
  });

  it("builds claim code message with welcome URL", () => {
    const message = buildClaimCodeShareMessage({
      allianceName: "LFgo",
      welcomeUrl: "https://hq.example/welcome?tag=LFgo&code=LFGO-D4E5F6",
    });
    expect(message).toContain("https://hq.example/welcome");
    expect(message).not.toContain("/join");
  });

  it("prefers welcome URL over legacy invite URL in invite link message", () => {
    const message = buildInviteLinkShareMessage({
      allianceName: "LFgo",
      inviteUrl: "https://hq.example/invite/legacy",
      welcomeUrl: "https://hq.example/welcome?invite=legacy",
    });
    expect(message).toContain("https://hq.example/welcome?invite=legacy");
    expect(message).not.toContain("/invite/legacy");
  });
});
