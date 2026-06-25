import { beforeEach, describe, expect, it, vi } from "vitest";

import { runWebMemberLinkSubmit } from "./orchestrator.server";

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

vi.mock("@/lib/member-link/privileged-link.server", () => ({
  assertPrivilegedAshedGate: vi.fn().mockResolvedValue({ ok: true }),
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
}));

const lookup = await import("@/lib/lastwar/player-lookup");
const roster = await import("@/lib/member-link/roster-link-request.server");

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
});
