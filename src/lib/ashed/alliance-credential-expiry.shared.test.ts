import { describe, expect, it } from "vitest";

import {
  allianceCredentialExpiryStage,
  allianceCredentialNoticeDue,
  decideAllianceCredentialRefresh,
  jwtPayloadMatchesAshedUser,
} from "./alliance-credential-expiry.shared";

const now = new Date("2026-10-10T12:00:00Z");
const days = (n: number) => new Date(now.getTime() + n * 24 * 60 * 60 * 1000);

describe("allianceCredentialExpiryStage", () => {
  it("is null without an expiry or outside the reminder window", () => {
    expect(allianceCredentialExpiryStage(null, now)).toBeNull();
    expect(allianceCredentialExpiryStage(days(30), now)).toBeNull();
  });

  it("is upcoming inside the window and expired after", () => {
    expect(allianceCredentialExpiryStage(days(14), now)).toBe("upcoming");
    expect(allianceCredentialExpiryStage(days(1), now)).toBe("upcoming");
    expect(allianceCredentialExpiryStage(days(-1), now)).toBe("expired");
  });
});

describe("allianceCredentialNoticeDue", () => {
  it("sends each stage once", () => {
    expect(allianceCredentialNoticeDue("upcoming", null)).toBe("upcoming");
    expect(allianceCredentialNoticeDue("upcoming", "upcoming")).toBeNull();
    expect(allianceCredentialNoticeDue("expired", "upcoming")).toBe("expired");
    expect(allianceCredentialNoticeDue("expired", null)).toBe("expired");
    expect(allianceCredentialNoticeDue("expired", "expired")).toBeNull();
  });

  it("never steps back from expired to upcoming", () => {
    expect(allianceCredentialNoticeDue("upcoming", "expired")).toBeNull();
    expect(allianceCredentialNoticeDue(null, "expired")).toBeNull();
  });
});

describe("decideAllianceCredentialRefresh", () => {
  const base = {
    hasAllianceCredential: true,
    storedExpiresAt: days(-60),
    newExpiresAt: days(90),
    isAshedOwner: false,
    isSameRegistrant: true,
    isSameAshedIdentity: true,
    now,
  };

  it("refreshes an expired token for its registrant when Ashed identity matches", () => {
    expect(decideAllianceCredentialRefresh(base)).toEqual({ refresh: true });
  });

  it("registrant alone must not authorize collaborator overwrite", () => {
    // Share delegate stamped as registrant reconnects with a different Ashed
    // identity (collaborator JWT) — must not replace the stored owner token.
    expect(
      decideAllianceCredentialRefresh({
        ...base,
        isSameRegistrant: true,
        isSameAshedIdentity: false,
        isAshedOwner: false,
      }),
    ).toEqual({ refresh: false, reason: "not_authorized" });
  });

  it("same Ashed identity alone must not authorize non-owner refresh", () => {
    // Collaborator JWT left in place by time-off repair — reconnect must not
    // grant perpetual refresh without owner role or registrant+identity.
    expect(
      decideAllianceCredentialRefresh({
        ...base,
        isSameRegistrant: false,
        isSameAshedIdentity: true,
        isAshedOwner: false,
      }),
    ).toEqual({ refresh: false, reason: "not_authorized" });
  });

  it("refreshes for the Ashed owner", () => {
    expect(
      decideAllianceCredentialRefresh({
        ...base,
        isSameRegistrant: false,
        isSameAshedIdentity: false,
        isAshedOwner: true,
      }),
    ).toEqual({ refresh: true });
  });

  it("refuses other officers", () => {
    expect(
      decideAllianceCredentialRefresh({
        ...base,
        isSameRegistrant: false,
        isSameAshedIdentity: false,
      }),
    ).toEqual({
      refresh: false,
      reason: "not_authorized",
    });
  });

  it("never installs a missing credential", () => {
    expect(
      decideAllianceCredentialRefresh({ ...base, hasAllianceCredential: false }),
    ).toMatchObject({ refresh: false, reason: "no_alliance_credential" });
  });

  it("only replaces with a longer-lived, unexpired token", () => {
    expect(
      decideAllianceCredentialRefresh({ ...base, storedExpiresAt: days(120) }),
    ).toMatchObject({ reason: "not_longer_lived" });
    expect(
      decideAllianceCredentialRefresh({ ...base, newExpiresAt: days(-1) }),
    ).toMatchObject({ reason: "new_token_expired" });
    expect(
      decideAllianceCredentialRefresh({ ...base, newExpiresAt: null }),
    ).toMatchObject({ reason: "no_new_expiry" });
  });

  it("treats a stored token without expiry as replaceable", () => {
    expect(
      decideAllianceCredentialRefresh({ ...base, storedExpiresAt: null }),
    ).toEqual({ refresh: true });
  });
});

describe("jwtPayloadMatchesAshedUser", () => {
  it("matches id or email claims", () => {
    expect(jwtPayloadMatchesAshedUser({ sub: "u1" }, { id: "u1" })).toBe(true);
    expect(jwtPayloadMatchesAshedUser({ sub: "A@x.io" }, { email: "a@x.io" })).toBe(true);
    expect(jwtPayloadMatchesAshedUser({ email: "a@x.io" }, { email: "A@x.io" })).toBe(true);
  });

  it("rejects mismatches and empty payloads", () => {
    expect(jwtPayloadMatchesAshedUser({ sub: "u2" }, { id: "u1", email: "a@x.io" })).toBe(false);
    expect(jwtPayloadMatchesAshedUser(null, { id: "u1" })).toBe(false);
    expect(jwtPayloadMatchesAshedUser({ sub: "u1" }, {})).toBe(false);
  });
});
