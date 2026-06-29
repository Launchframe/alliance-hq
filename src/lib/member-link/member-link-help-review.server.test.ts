import { describe, expect, it } from "vitest";

import { unlinkHqMemberLinkBreakGlass } from "./member-link-help-review.server";

describe("member-link-help-review break-glass stub", () => {
  it("unlinkHqMemberLinkBreakGlass is not implemented yet", async () => {
    const result = await unlinkHqMemberLinkBreakGlass({
      allianceId: "a1",
      ashedMemberId: "m1",
      sessionId: "s1",
      resolvedByHqUserId: "u1",
    });
    expect(result).toEqual({ ok: false, reason: "not_implemented" });
  });
});
