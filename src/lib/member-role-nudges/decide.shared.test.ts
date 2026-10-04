import { describe, expect, it } from "vitest";

import { decideMemberRoleNudge } from "@/lib/member-role-nudges/decide.shared";
import {
  crossedIntoOfficerRank,
  crossedOutOfOfficerRank,
  OFFICER_RANK,
  type MemberRoleNudgeKind,
} from "@/lib/member-role-nudges/types.shared";

describe("decideMemberRoleNudge", () => {
  const neverRejected = () => false;

  it("opens escalate_invite when R3→R4 with no HQ membership", () => {
    expect(
      decideMemberRoleNudge({
        previousRank: 3,
        nextRank: 4,
        hqRoleName: null,
        hasActiveMembership: false,
        rejectedKindStillApplies: neverRejected,
      }),
    ).toEqual({
      action: "open",
      kind: "escalate_invite",
      supersedeKinds: ["deescalate"],
    });
  });

  it("opens escalate_elevate when R3→R4 with member HQ role", () => {
    expect(
      decideMemberRoleNudge({
        previousRank: 3,
        nextRank: 4,
        hqRoleName: "member",
        hasActiveMembership: true,
        rejectedKindStillApplies: neverRejected,
      }),
    ).toEqual({
      action: "open",
      kind: "escalate_elevate",
      supersedeKinds: ["deescalate"],
    });
  });

  it("skips escalate when already officer+", () => {
    expect(
      decideMemberRoleNudge({
        previousRank: 3,
        nextRank: 4,
        hqRoleName: "officer",
        hasActiveMembership: true,
        rejectedKindStillApplies: neverRejected,
      }).action,
    ).toBe("skip");
  });

  it("opens deescalate when R4→R3 and HQ officer", () => {
    expect(
      decideMemberRoleNudge({
        previousRank: 4,
        nextRank: 3,
        hqRoleName: "officer",
        hasActiveMembership: true,
        rejectedKindStillApplies: neverRejected,
      }),
    ).toEqual({
      action: "open",
      kind: "deescalate",
      supersedeKinds: ["escalate_invite", "escalate_elevate"],
    });
  });

  it("never demotes owner/maintainer on R4 loss", () => {
    const decision = decideMemberRoleNudge({
      previousRank: 4,
      nextRank: 2,
      hqRoleName: "owner",
      hasActiveMembership: true,
      rejectedKindStillApplies: neverRejected,
    });
    expect(decision.action).toBe("skip");
    if (decision.action === "skip") {
      expect(decision.reason).toBe("never_demote_owner_maintainer");
    }
  });

  it("blocks re-open after rejection while state unchanged", () => {
    const rejected = (kind: MemberRoleNudgeKind) => kind === "escalate_invite";
    const decision = decideMemberRoleNudge({
      previousRank: 3,
      nextRank: 4,
      hqRoleName: null,
      hasActiveMembership: false,
      rejectedKindStillApplies: rejected,
    });
    expect(decision.action).toBe("skip");
    if (decision.action === "skip") {
      expect(decision.reason).toBe("rejected_while_unchanged");
    }
  });
});

describe("rank crossing helpers", () => {
  it("treats null→R4 as into officer rank", () => {
    expect(crossedIntoOfficerRank(null, OFFICER_RANK)).toBe(true);
  });

  it("treats R4→null as out of officer rank", () => {
    expect(crossedOutOfOfficerRank(OFFICER_RANK, null)).toBe(true);
  });
});
