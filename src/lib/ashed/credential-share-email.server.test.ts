import { describe, expect, it } from "vitest";

import {
  buildCredentialShareAcceptedEmail,
  buildCredentialShareExpiredEmail,
  buildCredentialShareInviteEmail,
  buildCredentialShareOwnerDigestEmail,
  buildCredentialShareRejectedEmail,
  buildCredentialShareRevokedEmail,
} from "@/lib/ashed/credential-share-email.server";

describe("credential-share-email", () => {
  it("builds invite email with capabilities", () => {
    const email = buildCredentialShareInviteEmail({
      allianceTag: "LFgo",
      ownerLabel: "owner@e2e.test",
      inviteUrl: "https://hq.test/pair?token=abc",
      capabilities: ["roster:sync", "video:process"],
      expiresAt: "2026-08-01T00:00:00.000Z",
    });
    expect(email.subject).toContain("LFgo");
    expect(email.text).toContain("roster:sync");
    expect(email.html).toContain("https://hq.test/pair?token=abc");
  });

  it("builds owner digest email", () => {
    const email = buildCredentialShareOwnerDigestEmail({
      allianceTag: "LFgo",
      activityCount: 3,
      dayLabel: "2026-07-31",
    });
    expect(email.text).toContain("3");
    expect(email.subject).toContain("2026-07-31");
  });

  it("builds accepted email for owner", () => {
    const email = buildCredentialShareAcceptedEmail({
      allianceTag: "LFgo",
      delegateLabel: "officer@e2e.test",
    });
    expect(email.subject).toContain("accepted");
    expect(email.text).toContain("officer@e2e.test");
  });

  it("builds rejected email for owner", () => {
    const email = buildCredentialShareRejectedEmail({
      allianceTag: "LFgo",
      delegateLabel: "officer@e2e.test",
    });
    expect(email.subject).toContain("declined");
  });

  it("builds revoked email for delegate", () => {
    const email = buildCredentialShareRevokedEmail({
      allianceTag: "LFgo",
      ownerLabel: "owner@e2e.test",
    });
    expect(email.text).toContain("revoked");
    expect(email.html).toContain("owner@e2e.test");
  });

  it("builds expired email for owner and delegate roles", () => {
    const ownerEmail = buildCredentialShareExpiredEmail({
      allianceTag: "LFgo",
      endReason: "expired",
      recipientRole: "owner",
    });
    const delegateEmail = buildCredentialShareExpiredEmail({
      allianceTag: "LFgo",
      endReason: "owner_token_expired",
      recipientRole: "delegate",
    });
    expect(ownerEmail.subject).toContain("LFgo");
    expect(delegateEmail.text).toContain("token expired");
  });
});
