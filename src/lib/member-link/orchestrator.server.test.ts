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
    rosterSource: "native",
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

describe("runWebMemberLinkSubmit onboarding unblockers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(roster.isOwnerColdStartEligible).mockResolvedValue(true);
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

  it("bootstraps with owner lookup fallback and provided server", async () => {
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
    expect(roster.tryBootstrapOwnerColdStartMember).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerProvidedServerNumber: 1203,
        lookup: expect.objectContaining({ gameUserName: "Commander" }),
      }),
    );
    expect(lookup.lookupPlayerByUid).not.toHaveBeenCalled();
  });

  it("never echoes the submitted player UID in the success response", async () => {
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
