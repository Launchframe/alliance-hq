import { describe, expect, it } from "vitest";

import { toMemberLinkApiResponse } from "@/lib/member-link/outcome.shared";

describe("toMemberLinkApiResponse", () => {
  it("maps fuzzy pick pending", () => {
    const response = toMemberLinkApiResponse({
      reply: "pick",
      pending: {
        kind: "link_fuzzy_pick",
        candidates: [{ memberId: "m1", name: "Alice" }],
        gameUid: "123",
        gameUserName: "Alice",
        reportedName: "Alice",
      },
    });
    expect(response.outcome).toBe("fuzzy_pick");
    expect(response.candidates).toHaveLength(1);
  });

  it("maps walkthrough pending", () => {
    const response = toMemberLinkApiResponse({
      reply: "steps",
      pending: { kind: "link_walkthrough", step: 1 },
    });
    expect(response.outcome).toBe("walkthrough");
    expect(response.walkthroughStep).toBe(1);
  });

  it("maps linked success", () => {
    const response = toMemberLinkApiResponse({
      reply: "ok",
      pending: null,
      linked: true,
      linkTarget: {
        ashedMemberId: "m1",
        memberDisplayName: "Bob",
        gameUid: "12345678901203",
      },
    });
    expect(response.outcome).toBe("linked");
    expect(response.linkedMemberName).toBe("Bob");
  });
});
