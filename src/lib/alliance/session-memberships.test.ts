import { describe, expect, it } from "vitest";

import {
  allianceLandingPath,
  pickAllianceMembershipForSession,
  resolveSessionAllianceId,
} from "@/lib/alliance/session-memberships";
import type { Session } from "@/lib/db/schema";

function makeSession(partial: Partial<Session>): Session {
  return {
    createdAt: new Date(),
    updatedAt: new Date(),
    expiresAt: new Date(Date.now() + 86400000),
    userLabel: null,
    allianceId: null,
    allianceTag: null,
    hqUserId: null,
    currentAllianceId: null,
    id: "s1",
    ...partial,
  };
}

describe("allianceLandingPath", () => {
  it("routes native alliances to /members", () => {
    expect(allianceLandingPath("native")).toBe("/members");
  });

  it("routes ashed alliances to /dashboard", () => {
    expect(allianceLandingPath("ashed")).toBe("/dashboard");
  });
});

describe("pickAllianceMembershipForSession", () => {
  it("auto-picks a sole membership", () => {
    expect(
      pickAllianceMembershipForSession(
        makeSession({ id: "s1", currentAllianceId: null }),
        [
          {
            id: "a1",
            tag: "LFgo",
            name: "LFgo",
            slug: "lfgo",
            roleName: "officer",
          },
        ],
      )?.id,
    ).toBe("a1");
  });

  it("binds a matching resolved alliance id", () => {
    expect(
      pickAllianceMembershipForSession(
        makeSession({
          id: "s1",
          currentAllianceId: null,
          allianceId: "a1",
        }),
        [
          {
            id: "a1",
            tag: "LFgo",
            name: "LFgo",
            slug: "lfgo",
            roleName: "officer",
          },
          {
            id: "a2",
            tag: "Other",
            name: "Other",
            slug: "other",
            roleName: "member",
          },
        ],
      )?.id,
    ).toBe("a1");
  });

  it("does not pick when multiple memberships need an explicit choice", () => {
    expect(
      pickAllianceMembershipForSession(
        makeSession({ id: "s1", currentAllianceId: null }),
        [
          {
            id: "a1",
            tag: "A",
            name: "A",
            slug: "a",
            roleName: "officer",
          },
          {
            id: "a2",
            tag: "B",
            name: "B",
            slug: "b",
            roleName: "member",
          },
        ],
      ),
    ).toBeNull();
  });
});

describe("resolveSessionAllianceId", () => {
  it("prefers currentAllianceId over legacy allianceId", () => {
    expect(
      resolveSessionAllianceId(
        makeSession({
          id: "s1",
          currentAllianceId: "hq-1",
          allianceId: "ashed-1",
        }),
      ),
    ).toBe("hq-1");
  });

  it("falls back to allianceId when currentAllianceId is null", () => {
    expect(
      resolveSessionAllianceId(
        makeSession({
          id: "s1",
          allianceId: "ashed-1",
        }),
      ),
    ).toBe("ashed-1");
  });
});
