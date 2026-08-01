import { describe, expect, it } from "vitest";

import {
  buildCredentialShareInviteEmail,
  buildCredentialShareOwnerDigestEmail,
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
});
