import { describe, expect, it } from "vitest";

import { buildRosterLinkOwnerEmail } from "@/lib/member-link/roster-link-owner-email.server";

describe("buildRosterLinkOwnerEmail", () => {
  it("does not expose player UID in owner approval copy", () => {
    const email = buildRosterLinkOwnerEmail({
      allianceTag: "LFgo",
      gameUserName: "Commander",
      reportedName: "Commander",
      gameUid: "1234567890121203",
      gameServerNumber: 1203,
      requestId: "req-1",
      rejectToken: "reject-token",
    });

    expect(email.text).not.toContain("1234567890121203");
    expect(email.html).not.toContain("1234567890121203");
    expect(email.text).not.toContain("UID ending");
    expect(email.html).not.toContain("UID ending");
    expect(email.text).toContain("server 1203");
  });

  it("directs owners to in-app roster review instead of one-click approve", () => {
    const email = buildRosterLinkOwnerEmail({
      allianceTag: "LFgo",
      gameUserName: "Mew2407",
      reportedName: "Mew2407",
      gameUid: "1234567890121203",
      gameServerNumber: 1203,
      requestId: "req-1",
      rejectToken: "reject-token",
    });

    expect(email.html).toContain("Review in Alliance HQ");
    expect(email.html).not.toContain(">Approve</a>");
    expect(email.text).toContain("Review in Alliance HQ:");
    expect(email.text).toContain("/members/roster-link-requests?request=req-1");
    expect(email.text).not.toMatch(/Approve and Decline links/i);
    expect(email.text).toContain("An officer must sign in to Alliance HQ");
  });
});
