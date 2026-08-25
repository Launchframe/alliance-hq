import { describe, expect, it } from "vitest";

import {
  hybridLeadershipInviteRoleForRank,
  HYBRID_OFFICER_INVITE_RANK,
  HYBRID_OWNER_INVITE_RANK,
} from "@/lib/native-alliance/invite-rank-exceptions.shared";

describe("invite rank exceptions", () => {
  it("maps R4 to officer and R5 to owner", () => {
    expect(hybridLeadershipInviteRoleForRank(HYBRID_OFFICER_INVITE_RANK)).toBe(
      "officer",
    );
    expect(hybridLeadershipInviteRoleForRank(HYBRID_OWNER_INVITE_RANK)).toBe(
      "owner",
    );
    expect(hybridLeadershipInviteRoleForRank(3)).toBeNull();
    expect(hybridLeadershipInviteRoleForRank(null)).toBeNull();
  });
});
