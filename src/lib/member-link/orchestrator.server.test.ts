import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  runWebMemberLinkPreview,
  runWebMemberLinkStartOver,
  runWebMemberLinkSubmit,
} from "./orchestrator.server";

vi.mock("@/lib/events/admin-alerts", () => ({
  emitAdminAlert: vi.fn().mockResolvedValue(undefined),
  emitMemberLinkUidTakenAlert: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/rbac/context", () => ({
  getRbacContext: vi.fn().mockResolvedValue({
    email: "owner@example.com",
    displayName: "Owner",
    roleName: "owner",
    isPlatformMaintainer: false,
  }),
}));

vi.mock("@/lib/member-link/repository.server", () => ({
  getHqMemberLinkForUser: vi.fn().mockResolvedValue(null),
  getHqMemberLinkPending: vi.fn().mockResolvedValue(null),
  saveHqMemberLinkPending: vi.fn().mockResolvedValue(undefined),
  linkHqMember: vi.fn(),
  maybeSetOwnerMemberExternalId: vi.fn().mockResolvedValue(undefined),
  syncPrimaryGameUidFromHqMemberLink: vi.fn(),
}));

vi.mock("@/lib/onboarding/onboarding-audit.server", () => ({
  recordMemberLinkSubmit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/lastwar/player-lookup", () => ({
  lookupPlayerByUid: vi.fn(),
}));

vi.mock("@/lib/vr/member-roster", () => ({
  loadAllianceMembersForMemberLink: vi.fn().mockResolvedValue({
    members: [],
    rosterSource: "native_local",
  }),
  loadAllianceMembersForMemberLinkWithLiveRetry: vi.fn().mockResolvedValue({
    members: [],
    rosterSource: "native_local",
  }),
}));

vi.mock("@/lib/vr/repository", () => ({
  getLinkedMemberIds: vi.fn().mockResolvedValue(new Set()),
  getAllianceById: vi.fn().mockResolvedValue({ tag: "TST" }),
}));

vi.mock("@/lib/member-link/roster-link-request.server", () => ({
  isOwnerColdStartEligible: vi.fn().mockResolvedValue(true),
  tryBootstrapOwnerColdStartMember: vi.fn().mockResolvedValue(null),
  tryRouteRosterMissToOwnerApproval: vi.fn().mockResolvedValue(null),
  resolveMemberLinkServerGate: vi.fn().mockResolvedValue({
    ok: true,
    playerServer: 1203,
  }),
  getRosterLinkRequestById: vi.fn(),
  supersedePendingRosterLinkRequests: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/member-link/claim.server", () => ({
  getMemberLinkClaimTarget: vi.fn().mockResolvedValue(null),
  blockSelfServiceWhenClaimPending: vi.fn().mockResolvedValue(null),
}));

const lookup = await import("@/lib/lastwar/player-lookup");
const roster = await import("@/lib/member-link/roster-link-request.server");
const claim = await import("@/lib/member-link/claim.server");
const memberRoster = await import("@/lib/vr/member-roster");
const repository = await import("@/lib/member-link/repository.server");

describe("runWebMemberLinkSubmit onboarding unblockers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(roster.isOwnerColdStartEligible).mockResolvedValue(true);
    vi.mocked(roster.resolveMemberLinkServerGate).mockResolvedValue({
      ok: true,
      playerServer: 1203,
    });
    vi.mocked(memberRoster.loadAllianceMembersForMemberLink).mockResolvedValue({
      members: [],
      rosterSource: "native_local",
    });
  });

  it("returns name_mismatch with lookup name for retry", async () => {
    vi.mocked(lookup.lookupPlayerByUid).mockResolvedValue({
      ok: true,
      gameUserName: "Exact Commander",
      gameServerNumber: 1203,
    });

    const result = await runWebMemberLinkSubmit({
      sessionId: "sess-1",
      allianceId: "a1",
      hqUserId: "u1",
      locale: "en-US",
      reportedName: "Wrong Name",
      gameUid: "1234567890121203",
    });

    expect(result.outcome).toBe("name_mismatch");
    expect(result.lookupGameUserName).toBe("Exact Commander");
  });

  it("returns lookup_fallback when Last War API is down for owner cold-start", async () => {
    vi.mocked(lookup.lookupPlayerByUid).mockResolvedValue({
      ok: false,
      reason: "request_failed",
      message: "Could not reach the game server. Try again in a moment.",
    });

    const result = await runWebMemberLinkSubmit({
      sessionId: "sess-1",
      allianceId: "a1",
      hqUserId: "u1",
      locale: "en-US",
      reportedName: "Commander",
      gameUid: "1234567890121203",
    });

    expect(result.outcome).toBe("lookup_fallback");
  });

  it("bootstraps with owner lookup fallback only when Last War API is down", async () => {
    vi.mocked(lookup.lookupPlayerByUid).mockResolvedValue({
      ok: false,
      reason: "request_failed",
      message: "Could not reach the game server. Try again in a moment.",
    });
    vi.mocked(roster.tryBootstrapOwnerColdStartMember).mockResolvedValue({
      outcome: "linked",
      message: "Linked",
      pending: null,
      linkedMemberName: "Commander",
    });

    const result = await runWebMemberLinkSubmit({
      sessionId: "sess-1",
      allianceId: "a1",
      hqUserId: "u1",
      locale: "en-US",
      reportedName: "Commander",
      gameUid: "1234567890121203",
      ownerProvidedServerNumber: 1203,
      ownerLookupFallback: true,
    });

    expect(result.outcome).toBe("linked");
    expect(lookup.lookupPlayerByUid).toHaveBeenCalledWith("1234567890121203");
    expect(roster.tryBootstrapOwnerColdStartMember).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerProvidedServerNumber: 1203,
        lookup: expect.objectContaining({ gameUserName: "Commander" }),
      }),
    );
  });

  it("ignores ownerLookupFallback when Last War API is reachable", async () => {
    vi.mocked(lookup.lookupPlayerByUid).mockResolvedValue({
      ok: true,
      gameUserName: "Exact Commander",
      gameServerNumber: 1203,
    });

    const result = await runWebMemberLinkSubmit({
      sessionId: "sess-1",
      allianceId: "a1",
      hqUserId: "u1",
      locale: "en-US",
      reportedName: "Fake Name",
      gameUid: "1234567890121203",
      ownerProvidedServerNumber: 9999,
      ownerLookupFallback: true,
    });

    expect(result.outcome).toBe("name_mismatch");
    expect(roster.tryBootstrapOwnerColdStartMember).not.toHaveBeenCalled();
  });

  it("never echoes the submitted player UID in the success response", async () => {
    vi.mocked(lookup.lookupPlayerByUid).mockResolvedValue({
      ok: false,
      reason: "request_failed",
      message: "Could not reach the game server. Try again in a moment.",
    });
    vi.mocked(roster.tryBootstrapOwnerColdStartMember).mockResolvedValue({
      outcome: "linked",
      message: "Linked",
      pending: null,
      linkedMemberName: "Commander",
    });

    const result = await runWebMemberLinkSubmit({
      sessionId: "sess-1",
      allianceId: "a1",
      hqUserId: "u1",
      locale: "en-US",
      reportedName: "Commander",
      gameUid: "1234567890121203",
      ownerProvidedServerNumber: 1203,
      ownerLookupFallback: true,
    });

    expect(result.outcome).toBe("linked");
    expect(JSON.stringify(result)).not.toContain("1234567890121203");
  });

  it("never echoes the submitted player UID in name_mismatch retry copy", async () => {
    vi.mocked(lookup.lookupPlayerByUid).mockResolvedValue({
      ok: true,
      gameUserName: "Exact Commander",
      gameServerNumber: 1203,
    });

    const result = await runWebMemberLinkSubmit({
      sessionId: "sess-1",
      allianceId: "a1",
      hqUserId: "u1",
      locale: "en-US",
      reportedName: "Wrong Name",
      gameUid: "1234567890121203",
    });

    expect(result.outcome).toBe("name_mismatch");
    expect(JSON.stringify(result)).not.toContain("1234567890121203");
  });

  it("gates exact roster match through server eligibility before linking", async () => {
    vi.mocked(roster.isOwnerColdStartEligible).mockResolvedValue(false);
    vi.mocked(lookup.lookupPlayerByUid).mockResolvedValue({
      ok: true,
      gameUserName: "Same Name",
      gameServerNumber: 1205,
    });
    vi.mocked(memberRoster.loadAllianceMembersForMemberLink).mockResolvedValue({
      members: [
        {
          id: "m-exact",
          current_name: "Same Name",
          previous_names: [],
          status: "active",
        } as never,
      ],
      rosterSource: "native_local",
    });
    vi.mocked(roster.resolveMemberLinkServerGate).mockResolvedValue({
      ok: false,
      response: {
        outcome: "confirm_home_server",
        message: "Which server is home?",
        pending: null,
        lookupServerNumber: 1205,
        allianceServerNumber: 1203,
      },
    });

    const result = await runWebMemberLinkSubmit({
      sessionId: "sess-1",
      allianceId: "a1",
      hqUserId: "u1",
      locale: "en-US",
      reportedName: "Same Name",
      gameUid: "1234567890121205",
    });

    expect(result.outcome).toBe("confirm_home_server");
    expect(roster.resolveMemberLinkServerGate).toHaveBeenCalled();
    expect(repository.linkHqMember).not.toHaveBeenCalled();
  });
});

describe("runWebMemberLinkPreview (UID-only confirm step)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(roster.isOwnerColdStartEligible).mockResolvedValue(false);
  });

  it("returns confirm_identity with the looked-up name and server, without linking", async () => {
    vi.mocked(lookup.lookupPlayerByUid).mockResolvedValue({
      ok: true,
      gameUserName: "Found Commander",
      gameServerNumber: 1203,
    });

    const result = await runWebMemberLinkPreview({
      allianceId: "a1",
      hqUserId: "u1",
      locale: "en-US",
      gameUid: "1234567890121203",
    });

    expect(result.outcome).toBe("confirm_identity");
    expect(result.lookupGameUserName).toBe("Found Commander");
    expect(result.lookupServerNumber).toBe(1203);
  });

  it("never echoes the submitted player UID in the confirm response", async () => {
    vi.mocked(lookup.lookupPlayerByUid).mockResolvedValue({
      ok: true,
      gameUserName: "Found Commander",
      gameServerNumber: 1203,
    });

    const result = await runWebMemberLinkPreview({
      allianceId: "a1",
      hqUserId: "u1",
      locale: "en-US",
      gameUid: "1234567890121203",
    });

    expect(JSON.stringify(result)).not.toContain("1234567890121203");
  });

  it("returns lookup_error without calling Last War when no UID is provided", async () => {
    const result = await runWebMemberLinkPreview({
      allianceId: "a1",
      hqUserId: "u1",
      locale: "en-US",
    });

    expect(result.outcome).toBe("lookup_error");
    expect(lookup.lookupPlayerByUid).not.toHaveBeenCalled();
  });

  it("returns lookup_error for an invalid UID", async () => {
    vi.mocked(lookup.lookupPlayerByUid).mockResolvedValue({
      ok: false,
      reason: "not_found",
      message: "That UID was not found.",
    });

    const result = await runWebMemberLinkPreview({
      allianceId: "a1",
      hqUserId: "u1",
      locale: "en-US",
      gameUid: "1234567890121203",
    });

    expect(result.outcome).toBe("lookup_error");
  });

  it("falls back to manual name+server when the API is down for an eligible owner cold-start", async () => {
    vi.mocked(roster.isOwnerColdStartEligible).mockResolvedValue(true);
    vi.mocked(lookup.lookupPlayerByUid).mockResolvedValue({
      ok: false,
      reason: "request_failed",
      message: "Could not reach the game server.",
    });

    const result = await runWebMemberLinkPreview({
      allianceId: "a1",
      hqUserId: "u1",
      locale: "en-US",
      gameUid: "1234567890121203",
    });

    expect(result.outcome).toBe("lookup_fallback");
  });

  it("returns lookup_error when the API is down for a non-eligible member", async () => {
    vi.mocked(roster.isOwnerColdStartEligible).mockResolvedValue(false);
    vi.mocked(lookup.lookupPlayerByUid).mockResolvedValue({
      ok: false,
      reason: "request_failed",
      message: "Could not reach the game server.",
    });

    const result = await runWebMemberLinkPreview({
      allianceId: "a1",
      hqUserId: "u1",
      locale: "en-US",
      gameUid: "1234567890121203",
    });

    expect(result.outcome).toBe("lookup_error");
  });

  it("blocks preview when a commander claim invite is pending", async () => {
    vi.mocked(claim.blockSelfServiceWhenClaimPending).mockResolvedValue({
      outcome: "usage",
      message: "Use the claim screen.",
      pending: null,
    });

    const result = await runWebMemberLinkPreview({
      allianceId: "a1",
      hqUserId: "u1",
      locale: "en-US",
      gameUid: "1234567890121203",
    });

    expect(result.outcome).toBe("usage");
    expect(lookup.lookupPlayerByUid).not.toHaveBeenCalled();
  });
});

describe("runWebMemberLinkStartOver", () => {
  beforeEach(() => {
    vi.mocked(claim.blockSelfServiceWhenClaimPending).mockResolvedValue(null);
  });

  it("supersedes pending roster-link requests before restarting walkthrough", async () => {
    const repo = await import("@/lib/member-link/repository.server");

    const result = await runWebMemberLinkStartOver({
      allianceId: "a1",
      hqUserId: "u1",
      locale: "en-US",
    });

    expect(roster.supersedePendingRosterLinkRequests).toHaveBeenCalledWith({
      allianceId: "a1",
      hqUserId: "u1",
    });
    expect(repo.saveHqMemberLinkPending).toHaveBeenCalledWith(
      "a1",
      "u1",
      expect.objectContaining({ kind: "link_walkthrough", step: 0 }),
    );
    expect(result.pending).toEqual(
      expect.objectContaining({ kind: "link_walkthrough", step: 0 }),
    );
  });
});
