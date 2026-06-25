import { describe, expect, it } from "vitest";

import { buildRosterLinkOwnerEmail } from "./roster-link-owner-email.server";

describe("buildRosterLinkOwnerEmail", () => {
  it("does not expose player UID in owner approval copy", () => {
    const email = buildRosterLinkOwnerEmail({
      allianceTag: "LFgo",
      gameUserName: "Commander",
      reportedName: "Commander",
      gameUid: "1234567890121203",
      gameServerNumber: 1203,
      acceptToken: "accept-token",
      rejectToken: "reject-token",
    });

    expect(email.text).not.toContain("1234567890121203");
    expect(email.html).not.toContain("1234567890121203");
    expect(email.text).not.toContain("UID ending");
    expect(email.html).not.toContain("UID ending");
    expect(email.text).toContain("server 1203");
  });
});
